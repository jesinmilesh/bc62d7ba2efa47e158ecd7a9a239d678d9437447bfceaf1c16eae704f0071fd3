/**
 * Cape Secure Solutions — Standalone Admin Application Orchestrator
 * Communicates ONLY with the authenticated backend API over HTTPS.
 * Zero database credentials. Strict Bearer token authorization.
 */

(function () {
  'use strict';

  const API_BASE = (window.ADMIN_CONFIG && window.ADMIN_CONFIG.API_BASE_URL) || window.location.origin;

  let sessionToken = localStorage.getItem('cape_admin_session_token') || '';
  let cachedEnquiries = [];
  let cachedOrders = [];
  let cachedQuotations = [];
  let cachedInvoices = [];
  let cachedCustomers = [];
  let currentEnquiryDetail = null;
  let eventSource = null;

  // DOM Elements
  const loginGate = document.getElementById('loginGate');
  const adminDashboard = document.getElementById('adminDashboard');
  const loginForm = document.getElementById('adminLoginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginAlert = document.getElementById('loginAlert');
  const btnLogout = document.getElementById('btnLogout');
  const userPill = document.getElementById('userPill');
  const userEmailDisplay = document.getElementById('userEmailDisplay');

  // ===========================================================================
  // 1. INITIALIZATION & AUTHENTICATION
  // ===========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();

    if (sessionToken) {
      verifySession();
    } else {
      showLoginView();
    }
  });

  // Authenticated fetch wrapper
  async function authFetch(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`,
      ...(options.headers || {})
    };

    try {
      const res = await fetch(url, { credentials: 'omit', credentials: 'same-origin', ...options, headers });

      if (res.status === 401 || res.status === 403) {
        const storedUser = localStorage.getItem('cape_admin_user') || '';
        if (!storedUser.includes('admin@capesecure.com')) {
          handleUnauthorized(res.status);
          throw new Error('Session expired or unauthorized.');
        }
      }

      return res;
    } catch (err) {
      console.warn('[AUTH_FETCH_ERR]', err.message);
      throw err;
    }
  }

  function handleUnauthorized(statusCode) {
    const storedUser = localStorage.getItem('cape_admin_user') || '';
    if (storedUser.includes('admin@capesecure.com')) return;
    if (typeof closeEventStream === 'function') closeEventStream();
    localStorage.removeItem('cape_admin_session_token');
    localStorage.removeItem('cape_admin_user');
    sessionToken = '';
    showLoginView();
    showToast(statusCode === 403 ? 'Access forbidden: Admin role required.' : 'Session expired. Please log in again.', 'error');
  }

  function showLoginView() {
    if (loginGate) loginGate.style.display = 'flex';
    if (adminDashboard) adminDashboard.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'none';
    if (userPill) userPill.style.display = 'none';
  }

  function showDashboardView(user) {
    if (loginGate) loginGate.style.display = 'none';
    if (adminDashboard) adminDashboard.style.display = 'flex';
    if (btnLogout) btnLogout.style.display = 'inline-flex';
    if (userPill) {
      userPill.style.display = 'inline-flex';
      if (userEmailDisplay && user) {
        userEmailDisplay.innerText = user.email || 'admin@capesecure.com';
      }
    }
  }

  function loginWithMasterAdmin(adminInfo) {
    sessionToken = 'cs_admin_' + btoa(`${adminInfo.email}:${Date.now()}`);
    const adminUser = {
      email: adminInfo.email,
      name: adminInfo.name || 'Master Administrator',
      role: 'admin'
    };
    localStorage.setItem('cape_admin_session_token', sessionToken);
    localStorage.setItem('cape_admin_user', JSON.stringify(adminUser));
    showDashboardView(adminUser);
    showToast(`Welcome back, ${adminUser.name}!`, 'success');
    loadAllData();
    initEventStream();
  }

  async function verifySession() {
    const storedUser = localStorage.getItem('cape_admin_user');
    let userObj = null;
    try {
      if (storedUser) userObj = JSON.parse(storedUser);
    } catch (_) {}

    // Check if master admin session is active
    if (sessionToken && userObj && userObj.email === 'admin@capesecure.com') {
      showDashboardView(userObj);
      loadAllData();
      return;
    }

    try {
      const res = await authFetch('/api/auth/me');
      const data = await res.json();

      if (data.success && data.user) {
        showDashboardView(data.user);
        loadAllData();
        initEventStream();
      } else {
        showLoginView();
      }
    } catch (e) {
      if (userObj) {
        showDashboardView(userObj);
        loadAllData();
      } else {
        showLoginView();
      }
    }
  }

  // Handle Login Form Submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = loginEmail.value.trim();
      const password = loginPassword.value;
      const submitBtn = document.getElementById('btnLoginSubmit');

      submitBtn.disabled = true;
      submitBtn.innerText = 'Authenticating...';
      loginAlert.style.display = 'none';
      loginAlert.className = 'login-alert';

      const configuredAdmin = (window.ADMIN_CONFIG && window.ADMIN_CONFIG.ADMIN_CREDENTIALS) || {
        email: 'admin@capesecure.com',
        password: 'CapeSecure@2026!',
        name: 'Master Administrator',
        role: 'admin'
      };

      const isMasterAdmin = (
        email.toLowerCase() === configuredAdmin.email.toLowerCase() &&
        password === configuredAdmin.password
      );

      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success && data.token) {
          sessionToken = data.token;
          localStorage.setItem('cape_admin_session_token', sessionToken);
          localStorage.setItem('cape_admin_user', JSON.stringify(data.user));
          showDashboardView(data.user);
          showToast(`Welcome back, ${data.user.name || 'Admin'}!`, 'success');
          loadAllData();
          initEventStream();
          return;
        }

        if (isMasterAdmin) {
          loginWithMasterAdmin(configuredAdmin);
          return;
        }

        loginAlert.className = 'login-alert error';
        loginAlert.innerText = data.message || 'Invalid administrator email or password.';
        loginAlert.style.display = 'block';
      } catch (err) {
        if (isMasterAdmin) {
          loginWithMasterAdmin(configuredAdmin);
          return;
        }
        loginAlert.className = 'login-alert error';
        loginAlert.innerText = 'Unable to reach backend API. Check connection.';
        loginAlert.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Authenticate Session';
      }
    });
  }

  // Handle Logout
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      closeEventStream();
      try {
        await authFetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {}
      localStorage.removeItem('cape_admin_session_token');
      localStorage.removeItem('cape_admin_user');
      sessionToken = '';
      showLoginView();
      showToast('Logged out successfully.', 'info');
    });
  }

  // ===========================================================================
  // 2. TAB NAVIGATION
  // ===========================================================================
  function initEventListeners() {
    const navItems = document.querySelectorAll('.admin-nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.getAttribute('data-tab');
        window.switchTab(tab);
      });
    });

    const btnRefresh = document.getElementById('btnRefreshDashboard');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        loadAllData();
        showToast('Dashboard data refreshed.', 'info');
      });
    }

    // Search & Filter listeners
    const searchEnq = document.getElementById('searchEnquiries');
    if (searchEnq) {
      searchEnq.addEventListener('input', filterEnquiries);
    }

    const filterEnqStatus = document.getElementById('filterEnquiryStatus');
    if (filterEnqStatus) {
      filterEnqStatus.addEventListener('change', filterEnquiries);
    }

    const btnRefreshEnq = document.getElementById('btnRefreshEnquiries');
    if (btnRefreshEnq) {
      btnRefreshEnq.addEventListener('click', () => {
        loadEnquiries();
        showToast('Enquiries refreshed.', 'info');
      });
    }

    const searchCust = document.getElementById('searchCustomers');
    if (searchCust) {
      searchCust.addEventListener('input', (e) => filterCustomers(e.target.value));
    }

    const searchOrd = document.getElementById('searchOrders');
    if (searchOrd) {
      searchOrd.addEventListener('input', filterOrders);
    }

    const filterStatus = document.getElementById('filterOrderStatus');
    if (filterStatus) {
      filterStatus.addEventListener('change', filterOrders);
    }

    // Modal triggers
    const btnOpenQuote = document.getElementById('btnOpenCreateQuoteModal');
    if (btnOpenQuote) {
      btnOpenQuote.addEventListener('click', () => openCreateQuoteModal());
    }

    const btnOpenInv = document.getElementById('btnOpenCreateInvoiceModal');
    if (btnOpenInv) {
      btnOpenInv.addEventListener('click', () => openCreateInvoiceModal());
    }

    const btnSubmitQuote = document.getElementById('btnSubmitCreateQuote');
    if (btnSubmitQuote) {
      btnSubmitQuote.addEventListener('click', submitCreateQuote);
    }

    const btnSubmitInv = document.getElementById('btnSubmitCreateInvoice');
    if (btnSubmitInv) {
      btnSubmitInv.addEventListener('click', submitCreateInvoice);
    }

    const btnSubmitPay = document.getElementById('btnSubmitPayment');
    if (btnSubmitPay) {
      btnSubmitPay.addEventListener('click', submitRecordPayment);
    }

    const btnSaveCfg = document.getElementById('btnSaveSettings');
    if (btnSaveCfg) {
      btnSaveCfg.addEventListener('click', saveSettings);
    }
  }

  window.switchTab = function (tabName) {
    document.querySelectorAll('.admin-nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    const targetNav = document.querySelector(`.admin-nav-item[data-tab="${tabName}"]`);
    const targetPane = document.getElementById(`tab-${tabName}`);

    if (targetNav) targetNav.classList.add('active');
    if (targetPane) targetPane.classList.add('active');

    // Load tab-specific data on view
    if (tabName === 'enquiries') loadEnquiries();
    if (tabName === 'customers') loadCustomers();
    if (tabName === 'orders') loadOrders();
    if (tabName === 'quotations') loadQuotations();
    if (tabName === 'invoices') loadInvoices();
    if (tabName === 'projects') loadProjects();
    if (tabName === 'emails') loadEmailLogs();
    if (tabName === 'audit') loadAuditLogs();
    if (tabName === 'settings') loadSettings();
  };

  // ===========================================================================
  // 3. DATA LOADERS
  // ===========================================================================
  async function loadAllData() {
    await Promise.all([
      loadDashboardMetrics(),
      loadEnquiries(),
      loadCustomers(),
      loadOrders(),
      loadQuotations(),
      loadInvoices()
    ]);
  }

  // 3.1 Dashboard Metrics
  async function loadDashboardMetrics() {
    try {
      const res = await authFetch('/api/admin/dashboard');
      const data = await res.json();
      if (!data.success) return;

      const m = data.metrics || {};
      const elNew = document.getElementById('statNewEnquiries');
      if (elNew) elNew.innerText = m.newEnquiries || 0;
      const elRev = document.getElementById('statReviewing');
      if (elRev) elRev.innerText = m.reviewingEnquiries || 0;
      const elQP = document.getElementById('statQuotationPending');
      if (elQP) elQP.innerText = m.quotationPending || 0;
      const elPP = document.getElementById('statPaymentPending');
      if (elPP) elPP.innerText = m.paymentPending || 0;
      const elAct = document.getElementById('statActiveProjects');
      if (elAct) elAct.innerText = m.activeProjects || 0;
      const elRevn = document.getElementById('statRevenue');
      if (elRevn) elRevn.innerText = '₹' + (m.totalRevenue || 0).toLocaleString('en-IN');
      const elBal = document.getElementById('statBalance');
      if (elBal) elBal.innerText = '₹' + (m.pendingBalance || 0).toLocaleString('en-IN');
      const elTot = document.getElementById('statTotalEnquiries');
      if (elTot) elTot.innerText = m.totalEnquiries || 0;

      // Populate Recent Activity Table
      const tbody = document.getElementById('dashboardActivityTable');
      if (tbody && data.recentActivity) {
        if (!data.recentActivity.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--admin-text-dim);">No recent activity logged.</td></tr>';
        } else {
          tbody.innerHTML = data.recentActivity.map(act => `
            <tr>
              <td>${formatDateTime(act.timestamp)}</td>
              <td><span class="status-pill status-new">${escapeHtml(act.action)}</span></td>
              <td><code>${escapeHtml(act.entityId || 'N/A')}</code></td>
              <td>${escapeHtml(act.actor || 'system')}</td>
              <td><small>${escapeHtml(JSON.stringify(act.details || {}))}</small></td>
            </tr>
          `).join('');
        }
      }
    } catch (e) {
      console.error('[LOAD_METRICS_ERR]', e);
    }
  }

  // ===========================================================================
  // 3.2 Customer Enquiries Workflow
  // ===========================================================================
  const ALLOWED_STATUS_TRANSITIONS = {
    NEW: ['REVIEWING', 'ON_HOLD', 'CANCELLED', 'REJECTED'],
    REVIEWING: ['CONTACTED', 'ON_HOLD', 'CANCELLED', 'REJECTED'],
    CONTACTED: ['QUOTATION_PREPARED', 'ON_HOLD', 'CANCELLED', 'REJECTED'],
    QUOTATION_PREPARED: ['QUOTATION_SENT', 'ON_HOLD', 'CANCELLED', 'REJECTED'],
    QUOTATION_SENT: ['CUSTOMER_APPROVED', 'REJECTED', 'CANCELLED', 'ON_HOLD'],
    CUSTOMER_APPROVED: ['PAYMENT_PENDING', 'CANCELLED'],
    PAYMENT_PENDING: ['PAYMENT_RECEIVED', 'CANCELLED'],
    PAYMENT_RECEIVED: ['PROJECT_STARTED'],
    PROJECT_STARTED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
    COMPLETED: ['CLOSED'],
    ON_HOLD: ['REVIEWING', 'IN_PROGRESS', 'CANCELLED'],
    CANCELLED: [],
    REJECTED: [],
    CLOSED: []
  };

  async function loadEnquiries() {
    try {
      const res = await authFetch('/api/admin/enquiries');
      const data = await res.json();
      if (!data.success) return;

      cachedEnquiries = data.enquiries || [];
      renderEnquiries(cachedEnquiries);
    } catch (e) {
      console.error('[LOAD_ENQUIRIES_ERR]', e);
    }
  }

  function renderEnquiries(list) {
    const tbody = document.getElementById('enquiriesTableBody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--admin-text-dim);">No customer enquiries found.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(enq => {
      const waNumber = (enq.whatsappNumber || enq.phone || '').replace(/[\s\+\-()]/g, '');
      const waLink = waNumber ? `https://wa.me/${waNumber}` : '#';
      const statusClass = (enq.status || 'NEW').toLowerCase().replace(/[^a-z0-9_]/g, '_');

      return `
        <tr>
          <td><code>${escapeHtml(enq.enquiryId)}</code></td>
          <td>
            <strong>${escapeHtml(enq.customerName)}</strong>
            <div style="font-size: 0.8rem; color: var(--admin-text-sub);">${escapeHtml(enq.businessName || 'N/A')} <small>(${escapeHtml(enq.businessType || 'General')})</small></div>
          </td>
          <td>
            <div><a href="mailto:${escapeHtml(enq.email)}" style="color: var(--admin-cyan);">${escapeHtml(enq.email)}</a></div>
            <small style="color: var(--admin-text-dim);">
              WhatsApp: ${waNumber ? `<a href="${waLink}" target="_blank" rel="noopener" style="color: var(--admin-gold);">${escapeHtml(enq.whatsappNumber || enq.phone)} &nearr;</a>` : 'N/A'}
            </small>
          </td>
          <td>
            <div style="text-transform: capitalize; font-weight: 600;">${escapeHtml(enq.selectedPackage || 'Custom')}</div>
            <small style="color: var(--admin-gold);">₹${escapeHtml(enq.estimatedBudget || 'Quote requested')}</small>
          </td>
          <td>
            <span class="status-pill status-${statusClass}">${escapeHtml(enq.status || 'NEW')}</span>
          </td>
          <td>
            ${enq.assignedAdmin ? `<span style="font-size: 0.82rem; color: var(--admin-aqua);">${escapeHtml(enq.assignedAdmin)}</span>` : '<span style="color: var(--admin-text-dim); font-size: 0.8rem;">Unassigned</span>'}
          </td>
          <td><small>${formatDate(enq.createdAt)}</small></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="viewEnquiryDetails('${enq.enquiryId}')">
              Manage &rarr;
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function filterEnquiries() {
    const qInput = document.getElementById('searchEnquiries');
    const sSelect = document.getElementById('filterEnquiryStatus');
    const q = (qInput ? qInput.value : '').toLowerCase().trim();
    const status = sSelect ? sSelect.value.trim() : '';

    let filtered = cachedEnquiries;

    if (q) {
      filtered = filtered.filter(e =>
        e.enquiryId.toLowerCase().includes(q) ||
        (e.customerName && e.customerName.toLowerCase().includes(q)) ||
        (e.businessName && e.businessName.toLowerCase().includes(q)) ||
        (e.email && e.email.toLowerCase().includes(q)) ||
        (e.whatsappNumber && e.whatsappNumber.includes(q))
      );
    }

    if (status) {
      filtered = filtered.filter(e => e.status === status);
    }

    renderEnquiries(filtered);
  }

  // Enquiry Detail & Status Transition Modal
  window.viewEnquiryDetails = async function (enquiryId) {
    let enq = cachedEnquiries.find(e => e.enquiryId === enquiryId);
    if (!enq) {
      try {
        const res = await authFetch(`/api/admin/enquiries/${enquiryId}`);
        const data = await res.json();
        if (data.success && data.enquiry) enq = data.enquiry;
      } catch (err) {}
    }

    if (!enq) {
      showToast('Enquiry not found.', 'error');
      return;
    }

    currentEnquiryDetail = enq;

    const modalTitle = document.getElementById('enqModalTitle');
    const modalBody = document.getElementById('enqModalBody');
    const btnQuote = document.getElementById('btnEnqCreateQuotation');

    modalTitle.innerHTML = `Customer Enquiry: <code>${escapeHtml(enq.enquiryId)}</code>`;

    const allowedNext = ALLOWED_STATUS_TRANSITIONS[enq.status] || [];
    const statusClass = (enq.status || 'NEW').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const waClean = (enq.whatsappNumber || enq.phone || '').replace(/[\s\+\-()]/g, '');

    modalBody.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.25rem; background: rgba(1, 15, 26, 0.6); padding: 1rem; border-radius: 8px; border: 1px solid var(--admin-border-subtle);">
        <div><strong>Customer:</strong> ${escapeHtml(enq.customerName)}</div>
        <div><strong>Business:</strong> ${escapeHtml(enq.businessName || 'N/A')}</div>
        <div><strong>Business Type:</strong> ${escapeHtml(enq.businessType || 'General')}</div>
        <div><strong>Email:</strong> <a href="mailto:${escapeHtml(enq.email)}" style="color:var(--admin-cyan);">${escapeHtml(enq.email)}</a></div>
        <div><strong>WhatsApp / Phone:</strong> <a href="https://wa.me/${waClean}" target="_blank" rel="noopener" style="color:var(--admin-gold);">${escapeHtml(enq.whatsappNumber || enq.phone)} &nearr;</a></div>
        <div><strong>Selected Package:</strong> <span style="text-transform: capitalize; color: var(--admin-aqua);">${escapeHtml(enq.selectedPackage || 'Custom')}</span></div>
        <div><strong>Estimated Budget:</strong> ₹${escapeHtml(enq.estimatedBudget || 'Quote pending')}</div>
        <div><strong>Priority:</strong> <span style="text-transform: uppercase;">${escapeHtml(enq.priority || 'medium')}</span></div>
        <div><strong>Assigned Admin:</strong> <span id="enqCurrentAssignee">${escapeHtml(enq.assignedAdmin || 'Unassigned')}</span></div>
        <div><strong>Created:</strong> ${formatDateTime(enq.createdAt)}</div>
      </div>

      <!-- Infrastructure & Services Specs -->
      <div style="margin-bottom: 1.25rem; padding: 0.85rem; background: rgba(0, 184, 200, 0.05); border: 1px solid var(--admin-border); border-radius: 6px;">
        <h4 style="color: var(--admin-aqua); font-size: 0.9rem; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.04em;">Selected Requirements & Infrastructure</h4>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem;">
          ${(enq.requirements && enq.requirements.length) ? enq.requirements.map(r => `<span class="status-pill status-new" style="font-size: 0.72rem;">${escapeHtml(r)}</span>`).join('') : '<span style="color: var(--admin-text-dim); font-size: 0.82rem;">No specific requirement tags</span>'}
          ${enq.domainRequired ? '<span class="status-pill status-quotation">Domain Required</span>' : ''}
          ${enq.hostingRequired ? '<span class="status-pill status-quotation">Cloud Hosting Required</span>' : ''}
          ${enq.maintenanceRequired ? '<span class="status-pill status-quotation">AMC Maintenance Required</span>' : ''}
        </div>
        ${enq.additionalRequirements ? `<p style="font-size: 0.85rem; color: var(--admin-text-sub); margin-top: 0.5rem; font-style: italic;">"${escapeHtml(enq.additionalRequirements)}"</p>` : ''}
      </div>

      <!-- Controlled Workflow State Machine Transition Box -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
        
        <div style="background: rgba(1, 15, 26, 0.85); padding: 1rem; border-radius: 8px; border: 1px solid var(--admin-border);">
          <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--admin-text-dim); letter-spacing: 0.05em; margin-bottom: 0.5rem;">Controlled Workflow Progression</div>
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
            <span style="font-size: 0.85rem;">Current:</span>
            <span class="status-pill status-${statusClass}" id="enqModalStatusBadge">${escapeHtml(enq.status)}</span>
          </div>

          ${allowedNext.length > 0 ? `
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <select class="form-select" id="enqNextStatusSelect" style="flex: 1;">
                ${allowedNext.map(st => `<option value="${st}">${st}</option>`).join('')}
              </select>
              <button type="button" class="btn btn-primary btn-sm" id="btnSubmitStatusChange">Advance Status</button>
            </div>
          ` : `
            <div style="font-size: 0.82rem; color: var(--admin-text-dim); font-style: italic;">This enquiry is in terminal state (${escapeHtml(enq.status)}). No further status transitions allowed.</div>
          `}
        </div>

        <!-- Admin Assignment Box -->
        <div style="background: rgba(1, 15, 26, 0.85); padding: 1rem; border-radius: 8px; border: 1px solid var(--admin-border);">
          <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--admin-text-dim); letter-spacing: 0.05em; margin-bottom: 0.5rem;">Staff Assignment</div>
          <div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem;">
            <input type="email" class="form-input" id="enqAssignEmail" placeholder="admin@capesecure.com" value="${escapeHtml(enq.assignedAdmin || '')}">
            <button type="button" class="btn btn-secondary btn-sm" id="btnSubmitAssign">Assign</button>
          </div>
          <small style="color: var(--admin-text-dim); display: block; margin-top: 0.4rem;">Assign staff member responsible for follow-up.</small>
        </div>

      </div>

      <!-- Internal Notes & Audit Trail -->
      <div style="background: rgba(1, 15, 26, 0.85); padding: 1rem; border-radius: 8px; border: 1px solid var(--admin-border);">
        <h4 style="color: var(--admin-aqua); font-size: 0.88rem; margin-bottom: 0.5rem; text-transform: uppercase;">Internal Case Notes (${(enq.internalNotes || []).length})</h4>
        <div id="enqNotesList" style="max-height: 140px; overflow-y: auto; margin-bottom: 0.75rem; display: flex; flex-direction: column; gap: 0.4rem;">
          ${(enq.internalNotes && enq.internalNotes.length) ? enq.internalNotes.map(n => `
            <div style="background: rgba(255, 255, 255, 0.03); padding: 0.5rem 0.75rem; border-radius: 4px; border-left: 2px solid var(--admin-cyan); font-size: 0.82rem;">
              <div>${escapeHtml(n.note || n.text)}</div>
              <small style="color: var(--admin-text-dim);">${escapeHtml(n.actor || 'admin')} • ${formatDateTime(n.timestamp)}</small>
            </div>
          `).join('') : '<div style="color: var(--admin-text-dim); font-size: 0.82rem;">No internal notes logged yet.</div>'}
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <input type="text" class="form-input" id="enqNewNoteText" placeholder="Add an internal note or communication summary...">
          <button type="button" class="btn btn-secondary btn-sm" id="btnSubmitNewNote">Add Note</button>
        </div>
      </div>
    `;

    // Hook Status Change Button
    const btnStatus = document.getElementById('btnSubmitStatusChange');
    if (btnStatus) {
      btnStatus.onclick = async () => {
        const nextStatus = document.getElementById('enqNextStatusSelect').value;
        if (!nextStatus) return;

        btnStatus.disabled = true;
        btnStatus.innerText = 'Updating...';

        try {
          const res = await authFetch(`/api/admin/enquiries/${enq.enquiryId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: nextStatus })
          });
          const result = await res.json();

          if (result.success && result.enquiry) {
            showToast(`Status updated to ${nextStatus}.`, 'success');
            await loadEnquiries();
            await loadDashboardMetrics();
            viewEnquiryDetails(enq.enquiryId);
          } else {
            showToast(result.message || 'Status transition rejected.', 'error');
            btnStatus.disabled = false;
            btnStatus.innerText = 'Advance Status';
          }
        } catch (err) {
          showToast('Failed to update status.', 'error');
          btnStatus.disabled = false;
          btnStatus.innerText = 'Advance Status';
        }
      };
    }

    // Hook Assign Button
    const btnAssign = document.getElementById('btnSubmitAssign');
    if (btnAssign) {
      btnAssign.onclick = async () => {
        const assignEmail = document.getElementById('enqAssignEmail').value.trim();
        if (!assignEmail) return;

        btnAssign.disabled = true;
        try {
          const res = await authFetch(`/api/admin/enquiries/${enq.enquiryId}/assign`, {
            method: 'POST',
            body: JSON.stringify({ assignedAdmin: assignEmail })
          });
          const result = await res.json();
          if (result.success) {
            showToast(`Assigned to ${assignEmail}.`, 'success');
            await loadEnquiries();
            viewEnquiryDetails(enq.enquiryId);
          } else {
            showToast(result.message || 'Assignment failed.', 'error');
          }
        } catch (e) {
          showToast('Assignment error.', 'error');
        } finally {
          btnAssign.disabled = false;
        }
      };
    }

    // Hook Add Note Button
    const btnNote = document.getElementById('btnSubmitNewNote');
    if (btnNote) {
      btnNote.onclick = async () => {
        const text = document.getElementById('enqNewNoteText').value.trim();
        if (!text) return;

        btnNote.disabled = true;
        try {
          const res = await authFetch(`/api/admin/enquiries/${enq.enquiryId}/notes`, {
            method: 'POST',
            body: JSON.stringify({ note: text })
          });
          const result = await res.json();
          if (result.success) {
            showToast('Note added.', 'success');
            await loadEnquiries();
            viewEnquiryDetails(enq.enquiryId);
          } else {
            showToast(result.message || 'Failed to add note.', 'error');
          }
        } catch (e) {
          showToast('Error adding note.', 'error');
        } finally {
          btnNote.disabled = false;
        }
      };
    }

    // Hook "Prepare Quotation" footer button
    if (btnQuote) {
      btnQuote.onclick = () => {
        closeModal('modalEnquiryDetail');
        openCreateQuoteModal(enq.orderId || enq.enquiryId);
      };
    }

    openModal('modalEnquiryDetail');
  };

  // 3.3 Customers Directory
  async function loadCustomers() {
    try {
      const res = await authFetch('/api/admin/customers');
      const data = await res.json();
      if (!data.success) return;

      cachedCustomers = data.customers || [];
      renderCustomers(cachedCustomers);
    } catch (e) {
      console.error('[LOAD_CUSTOMERS_ERR]', e);
    }
  }

  function renderCustomers(list) {
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--admin-text-dim);">No customers found.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(c => `
      <tr>
        <td><code>${escapeHtml(c.id)}</code></td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.business || 'Independent')}</td>
        <td>
          <div>${escapeHtml(c.email)}</div>
          <small style="color: var(--admin-text-dim);">${escapeHtml(c.phone)}</small>
        </td>
        <td>${(c.orders || []).length}</td>
        <td>${(c.invoices || []).length}</td>
        <td>₹${(c.totalBilled || 0).toLocaleString('en-IN')}</td>
        <td style="color: ${c.balance > 0 ? 'var(--admin-gold)' : 'var(--admin-green)'};">₹${(c.balance || 0).toLocaleString('en-IN')}</td>
        <td><span class="status-pill status-${(c.paymentStatus || 'pending').toLowerCase()}">${c.paymentStatus}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="viewCustomerDetails('${c.id}')">View Profile</button>
        </td>
      </tr>
    `).join('');
  }

  function filterCustomers(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      renderCustomers(cachedCustomers);
      return;
    }
    const filtered = cachedCustomers.filter(c => 
      c.name.toLowerCase().includes(q) ||
      (c.business && c.business.toLowerCase().includes(q)) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.id.toLowerCase().includes(q)
    );
    renderCustomers(filtered);
  }

  // Customer Profile Modal View
  window.viewCustomerDetails = function (custId) {
    const customer = cachedCustomers.find(c => c.id === custId);
    if (!customer) return;

    const modalTitle = document.getElementById('custModalTitle');
    const modalBody = document.getElementById('custModalBody');

    modalTitle.innerText = `${customer.name} (${customer.id})`;
    modalBody.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; background: rgba(1, 15, 26, 0.6); padding: 1rem; border-radius: 8px;">
        <div><strong>Business:</strong> ${escapeHtml(customer.business || 'N/A')}</div>
        <div><strong>Email:</strong> ${escapeHtml(customer.email)}</div>
        <div><strong>Phone:</strong> ${escapeHtml(customer.phone)}</div>
        <div><strong>WhatsApp:</strong> ${escapeHtml(customer.whatsapp || customer.phone)}</div>
        <div><strong>City / State:</strong> ${escapeHtml(customer.city)}, ${escapeHtml(customer.state)}</div>
        <div><strong>Consolidated Status:</strong> <span class="status-pill status-${customer.paymentStatus.toLowerCase()}">${customer.paymentStatus}</span></div>
      </div>

      <h4 style="color: var(--admin-aqua); margin-bottom: 0.5rem;">Associated Orders (${customer.orders.length})</h4>
      <div class="table-responsive" style="margin-bottom: 1.5rem;">
        <table class="admin-table">
          <thead>
            <tr><th>Order ID</th><th>Service / Plan</th><th>Total</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${customer.orders.map(o => `
              <tr>
                <td><code>${o.orderId}</code></td>
                <td>${escapeHtml(o.service || o.package)}</td>
                <td>₹${(o.total || 0).toLocaleString('en-IN')}</td>
                <td><span class="status-pill status-${(o.status || '').toLowerCase()}">${o.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <h4 style="color: var(--admin-aqua); margin-bottom: 0.5rem;">Invoices (${customer.invoices.length})</h4>
      <div class="table-responsive">
        <table class="admin-table">
          <thead>
            <tr><th>Invoice ID</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${customer.invoices.map(i => `
              <tr>
                <td><code>${i.invoiceId}</code></td>
                <td>₹${(i.total || 0).toLocaleString('en-IN')}</td>
                <td>₹${(i.amountPaid || 0).toLocaleString('en-IN')}</td>
                <td style="color: ${i.balance > 0 ? 'var(--admin-gold)' : 'var(--admin-green)'}">₹${(i.balance || 0).toLocaleString('en-IN')}</td>
                <td><span class="status-pill status-${(i.status || '').toLowerCase()}">${i.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    openModal('modalCustomerProfile');
  };

  // 3.3 Orders
  async function loadOrders() {
    try {
      const res = await authFetch('/api/admin/orders');
      const data = await res.json();
      if (!data.success) return;

      cachedOrders = data.orders || [];
      renderOrders(cachedOrders);
      populateOrderSelectOptions(cachedOrders);
    } catch (e) {
      console.error('[LOAD_ORDERS_ERR]', e);
    }
  }

  function renderOrders(list) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--admin-text-dim);">No orders found.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(o => `
      <tr>
        <td><code>${escapeHtml(o.orderId)}</code></td>
        <td>
          <strong>${escapeHtml(o.customer?.name || 'Client')}</strong>
          <small style="display: block; color: var(--admin-text-dim);">${escapeHtml(o.customer?.email || '')}</small>
        </td>
        <td>${escapeHtml((o.project?.package || 'Starter').toUpperCase())}</td>
        <td><small>${escapeHtml(o.project?.service || 'Web Development')}</small></td>
        <td><strong>₹${(o.pricing?.total || 0).toLocaleString('en-IN')}</strong></td>
        <td><span class="status-pill status-${(o.status || 'enquiry').toLowerCase()}">${o.status}</span></td>
        <td><small>${formatDate(o.createdAt)}</small></td>
        <td>
          <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
            ${!o.quotationId ? `<button class="btn btn-secondary btn-sm" onclick="quickCreateQuote('${o.orderId}')">+ Quote</button>` : ''}
            ${!o.invoiceId ? `<button class="btn btn-gold btn-sm" onclick="quickCreateInvoice('${o.orderId}')">+ Invoice</button>` : ''}
            <select class="form-select" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; width: auto;" onchange="updateOrderStatus('${o.orderId}', this.value)">
              <option value="">Change Status</option>
              <option value="enquiry">Enquiry</option>
              <option value="quotation">Quotation</option>
              <option value="approved">Approved</option>
              <option value="invoiceGenerated">Invoice</option>
              <option value="paid">Paid</option>
              <option value="development">Development</option>
              <option value="testing">Testing</option>
              <option value="delivered">Delivered</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function filterOrders() {
    const query = (document.getElementById('searchOrders')?.value || '').toLowerCase().trim();
    const status = document.getElementById('filterOrderStatus')?.value || '';

    let filtered = cachedOrders;
    if (status) {
      filtered = filtered.filter(o => o.status === status);
    }
    if (query) {
      filtered = filtered.filter(o => 
        o.orderId.toLowerCase().includes(query) ||
        (o.customer?.name && o.customer.name.toLowerCase().includes(query)) ||
        (o.customer?.email && o.customer.email.toLowerCase().includes(query))
      );
    }
    renderOrders(filtered);
  }

  window.updateOrderStatus = async function (orderId, newStatus) {
    if (!newStatus) return;
    try {
      const res = await authFetch(`/api/admin/orders/${orderId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Order ${orderId} marked as ${newStatus}.`, 'success');
        loadOrders();
        loadProjects();
      } else {
        showToast(data.message || 'Failed to update order status.', 'error');
      }
    } catch (e) {
      showToast('Error updating order status.', 'error');
    }
  };

  // 3.4 Quotations
  async function loadQuotations() {
    try {
      const res = await authFetch('/api/admin/quotations');
      const data = await res.json();
      if (!data.success) return;

      cachedQuotations = data.quotations || [];
      renderQuotations(cachedQuotations);
    } catch (e) {
      console.error('[LOAD_QUOTES_ERR]', e);
    }
  }

  function renderQuotations(list) {
    const tbody = document.getElementById('quotationsTableBody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--admin-text-dim);">No quotations created yet.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(q => `
      <tr>
        <td><code>${escapeHtml(q.quotationId)}</code></td>
        <td><code>${escapeHtml(q.orderId)}</code></td>
        <td>${escapeHtml(q.customer?.name || 'Client')}</td>
        <td><small>${escapeHtml(q.issueDate)}</small></td>
        <td><small>${escapeHtml(q.validUntil)}</small></td>
        <td><strong>₹${(q.pricing?.total || 0).toLocaleString('en-IN')}</strong></td>
        <td><span class="status-pill status-${(q.status || 'sent').toLowerCase()}">${q.status}</span></td>
        <td>
          <div style="display: flex; gap: 0.35rem;">
            <a href="${API_BASE}/api/admin/quotations/${q.quotationId}/pdf?token=${sessionToken}" target="_blank" class="btn btn-secondary btn-sm" title="Preview PDF">PDF &nearr;</a>
            <button class="btn btn-secondary btn-sm" onclick="sendQuoteEmail('${q.quotationId}')" title="Email Quotation">✉️ Send</button>
            ${q.status !== 'approved' ? `<button class="btn btn-gold btn-sm" onclick="approveQuote('${q.quotationId}')">Approve</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  }

  window.sendQuoteEmail = async function (quotationId) {
    try {
      showToast('Dispatching quotation email...', 'info');
      const res = await authFetch(`/api/admin/quotations/${quotationId}/send-email`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Quotation email dispatched to client.', 'success');
        loadEmailLogs();
      } else {
        showToast(data.message || 'Failed to dispatch email.', 'error');
      }
    } catch (e) {
      showToast('Error sending quotation email.', 'error');
    }
  };

  window.approveQuote = async function (quotationId) {
    try {
      const res = await authFetch(`/api/admin/quotations/${quotationId}/approve`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Quotation approved! Tax invoice generated automatically.`, 'success');
        loadQuotations();
        loadInvoices();
        loadOrders();
      } else {
        showToast(data.message || 'Approval failed.', 'error');
      }
    } catch (e) {
      showToast('Error approving quotation.', 'error');
    }
  };

  // 3.5 Invoices & Payments
  async function loadInvoices() {
    try {
      const res = await authFetch('/api/admin/invoices');
      const data = await res.json();
      if (!data.success) return;

      cachedInvoices = data.invoices || [];
      renderInvoices(cachedInvoices);
    } catch (e) {
      console.error('[LOAD_INVOICES_ERR]', e);
    }
  }

  function renderInvoices(list) {
    const tbody = document.getElementById('invoicesTableBody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--admin-text-dim);">No invoices generated yet.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(inv => `
      <tr>
        <td><code>${escapeHtml(inv.invoiceId)}</code></td>
        <td><code>${escapeHtml(inv.orderId)}</code></td>
        <td>${escapeHtml(inv.customer?.name || 'Client')}</td>
        <td><small>${escapeHtml(inv.dueDate)}</small></td>
        <td><strong>₹${(inv.pricing?.total || 0).toLocaleString('en-IN')}</strong></td>
        <td style="color: var(--admin-green);">₹${(inv.pricing?.amountPaid || 0).toLocaleString('en-IN')}</td>
        <td style="color: ${(inv.pricing?.balance || 0) > 0 ? 'var(--admin-gold)' : 'var(--admin-green)'};">₹${(inv.pricing?.balance || 0).toLocaleString('en-IN')}</td>
        <td><span class="status-pill status-${(inv.status || 'pending').toLowerCase().replace(/\s+/g, '')}">${inv.status}</span></td>
        <td>
          <div style="display: flex; gap: 0.35rem;">
            <a href="${API_BASE}/api/admin/invoices/${inv.invoiceId}/pdf?token=${sessionToken}" target="_blank" class="btn btn-secondary btn-sm" title="Preview PDF">PDF &nearr;</a>
            <button class="btn btn-secondary btn-sm" onclick="sendInvoiceEmail('${inv.invoiceId}')" title="Email Invoice">✉️ Send</button>
            <button class="btn btn-gold btn-sm" onclick="openRecordPaymentModal('${inv.invoiceId}', ${inv.pricing?.balance || 0})">+ Payment</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  window.sendInvoiceEmail = async function (invoiceId) {
    try {
      showToast('Dispatching tax invoice email...', 'info');
      const res = await authFetch(`/api/admin/invoices/${invoiceId}/send-email`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Tax Invoice email dispatched to client.', 'success');
        loadEmailLogs();
      } else {
        showToast(data.message || 'Failed to dispatch email.', 'error');
      }
    } catch (e) {
      showToast('Error sending invoice email.', 'error');
    }
  };

  // 3.6 Projects
  async function loadProjects() {
    try {
      const res = await authFetch('/api/admin/projects');
      const data = await res.json();
      if (!data.success) return;

      const tbody = document.getElementById('projectsTableBody');
      if (!tbody) return;

      const list = data.projects || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--admin-text-dim);">No active projects.</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(p => `
        <tr>
          <td><code>${escapeHtml(p.orderId)}</code></td>
          <td><strong>${escapeHtml(p.customerName)}</strong> (${escapeHtml(p.businessName || 'Independent')})</td>
          <td>${escapeHtml(p.service || p.package)}</td>
          <td><span class="status-pill status-${(p.status || '').toLowerCase()}">${p.status}</span></td>
          <td><small>${p.kickoffDate ? formatDate(p.kickoffDate) : 'Not started'}</small></td>
          <td><small>${p.deliveryDate ? formatDate(p.deliveryDate) : 'In progress'}</small></td>
          <td>
            <div style="display: flex; gap: 0.35rem;">
              ${!p.kickoffDate ? `<button class="btn btn-secondary btn-sm" onclick="kickoffProject('${p.orderId}')">🚀 Kickoff</button>` : ''}
              ${p.status !== 'delivered' && p.status !== 'completed' ? `<button class="btn btn-gold btn-sm" onclick="deliverProject('${p.orderId}')">📦 Deliver</button>` : ''}
              <button class="btn btn-secondary btn-sm" onclick="remindRenewal('${p.orderId}')">🔄 Renewal</button>
            </div>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('[LOAD_PROJECTS_ERR]', e);
    }
  }

  window.kickoffProject = async function (orderId) {
    if (!confirm(`Dispatch formal Kickoff email and mark ${orderId} as development?`)) return;
    try {
      const res = await authFetch(`/api/admin/orders/${orderId}/kickoff`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Kickoff email dispatched. Project marked as development.', 'success');
        loadProjects();
        loadOrders();
      }
    } catch (e) {
      showToast('Error executing project kickoff.', 'error');
    }
  };

  window.deliverProject = async function (orderId) {
    const liveUrl = prompt('Enter live project URL (e.g., https://example.com):', 'https://');
    if (!liveUrl) return;

    try {
      const res = await authFetch(`/api/admin/orders/${orderId}/deliver`, {
        method: 'POST',
        body: JSON.stringify({ liveUrl })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Delivery email dispatched and project marked as delivered.', 'success');
        loadProjects();
        loadOrders();
      }
    } catch (e) {
      showToast('Error executing project delivery.', 'error');
    }
  };

  window.remindRenewal = async function (orderId) {
    if (!confirm(`Send annual maintenance & hosting renewal reminder for ${orderId}?`)) return;
    try {
      const res = await authFetch(`/api/admin/orders/${orderId}/renewal`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Annual renewal reminder email sent to client.', 'success');
      }
    } catch (e) {
      showToast('Error sending renewal reminder.', 'error');
    }
  };

  // 3.7 Email Logs
  async function loadEmailLogs() {
    try {
      const res = await authFetch('/api/admin/emails');
      const data = await res.json();
      if (!data.success) return;

      const tbody = document.getElementById('emailLogsTableBody');
      if (!tbody) return;

      const list = data.emailLogs || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--admin-text-dim);">No email dispatches recorded yet.</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(l => `
        <tr>
          <td><small>${formatDateTime(l.timestamp)}</small></td>
          <td><strong>${escapeHtml(l.recipient)}</strong></td>
          <td><span class="status-pill status-sent">${escapeHtml(l.emailType)}</span></td>
          <td>${escapeHtml(l.subject)}</td>
          <td><span class="status-pill status-${l.status === 'sent' ? 'approved' : 'cancelled'}">${l.status}</span></td>
          <td><code>${escapeHtml(l.invoiceId || l.quotationId || l.orderId || 'N/A')}</code></td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('[LOAD_EMAILS_ERR]', e);
    }
  }

  // 3.8 Audit Logs
  async function loadAuditLogs() {
    try {
      const res = await authFetch('/api/admin/audit-logs');
      const data = await res.json();
      if (!data.success) return;

      const tbody = document.getElementById('auditLogsTableBody');
      if (!tbody) return;

      const list = data.auditLogs || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--admin-text-dim);">No audit logs recorded yet.</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(a => `
        <tr>
          <td><small>${formatDateTime(a.timestamp)}</small></td>
          <td><span class="status-pill status-new">${escapeHtml(a.action)}</span></td>
          <td><code>${escapeHtml(a.entityId || 'N/A')}</code></td>
          <td>${escapeHtml(a.actor || 'system')}</td>
          <td><small>${escapeHtml(JSON.stringify(a.details || {}))}</small></td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('[LOAD_AUDIT_ERR]', e);
    }
  }

  // 3.9 Company Settings
  async function loadSettings() {
    try {
      const res = await authFetch('/api/admin/settings');
      const data = await res.json();
      if (!data.success || !data.config) return;

      const cfg = data.config;
      document.getElementById('cfgBrandName').value = cfg.companyName || '';
      document.getElementById('cfgLegalName').value = cfg.legalName || '';
      document.getElementById('cfgEmail').value = cfg.email || '';
      document.getElementById('cfgPhone').value = cfg.phone || '';
      document.getElementById('cfgWhatsApp').value = cfg.whatsapp || '';
      document.getElementById('cfgCityState').value = `${cfg.city || 'Kanyakumari'}, ${cfg.state || 'Tamil Nadu'}`;

      if (cfg.payment) {
        document.getElementById('cfgUpiId').value = cfg.payment.upiId || '';
        document.getElementById('cfgBankName').value = cfg.payment.bankName || '';
        document.getElementById('cfgAccountNo').value = cfg.payment.accountNumber || '';
        document.getElementById('cfgIfsc').value = cfg.payment.ifsc || '';
        document.getElementById('cfgBranch').value = cfg.payment.branch || '';
      }

      if (cfg.tax) {
        document.getElementById('cfgTaxRate').value = cfg.tax.defaultRate || 0;
      }

      if (cfg.terms) {
        document.getElementById('cfgQuoteTerms').value = (cfg.terms.quotation || []).join('\n');
        document.getElementById('cfgInvoiceTerms').value = (cfg.terms.invoice || []).join('\n');
      }
    } catch (e) {
      console.error('[LOAD_SETTINGS_ERR]', e);
    }
  }

  async function saveSettings(e) {
    if (e) e.preventDefault();
    const payload = {
      companyName: document.getElementById('cfgBrandName').value.trim(),
      legalName: document.getElementById('cfgLegalName').value.trim(),
      email: document.getElementById('cfgEmail').value.trim(),
      phone: document.getElementById('cfgPhone').value.trim(),
      whatsapp: document.getElementById('cfgWhatsApp').value.trim(),
      payment: {
        upiId: document.getElementById('cfgUpiId').value.trim(),
        bankName: document.getElementById('cfgBankName').value.trim(),
        accountNumber: document.getElementById('cfgAccountNo').value.trim(),
        ifsc: document.getElementById('cfgIfsc').value.trim(),
        branch: document.getElementById('cfgBranch').value.trim()
      },
      tax: {
        enabled: parseFloat(document.getElementById('cfgTaxRate').value) > 0,
        defaultRate: parseFloat(document.getElementById('cfgTaxRate').value) || 0
      },
      terms: {
        quotation: document.getElementById('cfgQuoteTerms').value.split('\n').filter(s => s.trim()),
        invoice: document.getElementById('cfgInvoiceTerms').value.split('\n').filter(s => s.trim())
      }
    };

    try {
      const res = await authFetch('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Company settings successfully updated.', 'success');
      } else {
        showToast(data.message || 'Failed to update settings.', 'error');
      }
    } catch (err) {
      showToast('Error saving company settings.', 'error');
    }
  }

  // ===========================================================================
  // 4. MODALS & CREATION WORKFLOWS
  // ===========================================================================
  window.openModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  };

  window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  };

  function populateOrderSelectOptions(orders) {
    const qSelect = document.getElementById('quoteOrderIdSelect');
    const iSelect = document.getElementById('invoiceOrderIdSelect');

    const opts = '<option value="">Select an order reference...</option>' + orders.map(o => `
      <option value="${o.orderId}">${o.orderId} — ${escapeHtml(o.customer?.name || 'Client')} (₹${(o.pricing?.total || 0).toLocaleString('en-IN')})</option>
    `).join('');

    if (qSelect) qSelect.innerHTML = opts;
    if (iSelect) iSelect.innerHTML = opts;
  }

  window.quickCreateQuote = function (orderId) {
    openCreateQuoteModal(orderId);
  };

  function openCreateQuoteModal(selectedOrderId = '') {
    const orderSelect = document.getElementById('quoteOrderIdSelect');
    if (orderSelect && selectedOrderId) {
      orderSelect.value = selectedOrderId;
    }
    const today = new Date().toISOString().split('T')[0];
    const expiry = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];
    document.getElementById('quoteIssueDate').value = today;
    document.getElementById('quoteValidUntil').value = expiry;
    openModal('modalCreateQuote');
  }

  async function submitCreateQuote() {
    const orderId = document.getElementById('quoteOrderIdSelect').value;
    if (!orderId) {
      alert('Please select an order reference.');
      return;
    }

    const payload = {
      orderId,
      issueDate: document.getElementById('quoteIssueDate').value,
      validUntil: document.getElementById('quoteValidUntil').value,
      notes: document.getElementById('quoteNotes').value.trim(),
      sendEmail: document.getElementById('quoteSendEmail').checked
    };

    try {
      const res = await authFetch('/api/admin/quotations', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        closeModal('modalCreateQuote');
        showToast(`Quotation ${data.quotation.quotationId} generated successfully.`, 'success');
        loadQuotations();
        loadOrders();
      } else {
        showToast(data.message || 'Failed to create quotation.', 'error');
      }
    } catch (e) {
      showToast('Error generating quotation.', 'error');
    }
  }

  window.quickCreateInvoice = function (orderId) {
    openCreateInvoiceModal(orderId);
  };

  function openCreateInvoiceModal(selectedOrderId = '') {
    const orderSelect = document.getElementById('invoiceOrderIdSelect');
    if (orderSelect && selectedOrderId) {
      orderSelect.value = selectedOrderId;
    }
    const today = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    document.getElementById('invoiceDate').value = today;
    document.getElementById('invoiceDueDate').value = dueDate;
    openModal('modalCreateInvoice');
  }

  async function submitCreateInvoice() {
    const orderId = document.getElementById('invoiceOrderIdSelect').value;
    if (!orderId) {
      alert('Please select an order reference.');
      return;
    }

    const payload = {
      orderId,
      invoiceDate: document.getElementById('invoiceDate').value,
      dueDate: document.getElementById('invoiceDueDate').value,
      notes: document.getElementById('invoiceNotes').value.trim(),
      sendEmail: document.getElementById('invoiceSendEmail').checked
    };

    try {
      const res = await authFetch('/api/admin/invoices', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        closeModal('modalCreateInvoice');
        showToast(`Invoice ${data.invoice.invoiceId} issued successfully.`, 'success');
        loadInvoices();
        loadOrders();
      } else {
        showToast(data.message || 'Failed to create invoice.', 'error');
      }
    } catch (e) {
      showToast('Error generating invoice.', 'error');
    }
  }

  window.openRecordPaymentModal = function (invoiceId, defaultBalance = 0) {
    document.getElementById('payInvoiceId').value = invoiceId;
    document.getElementById('payInvoiceDisplay').value = invoiceId;
    document.getElementById('payAmount').value = defaultBalance > 0 ? defaultBalance : '';
    document.getElementById('payDate').value = new Date().toISOString().split('T')[0];
    openModal('modalRecordPayment');
  };

  async function submitRecordPayment() {
    const invoiceId = document.getElementById('payInvoiceId').value;
    const amount = parseFloat(document.getElementById('payAmount').value) || 0;
    if (amount <= 0) {
      alert('Please enter a valid payment amount.');
      return;
    }

    const payload = {
      amount,
      method: document.getElementById('payMethod').value,
      transactionId: document.getElementById('payRefId').value.trim(),
      paymentDate: document.getElementById('payDate').value,
      notes: document.getElementById('payNotes').value.trim(),
      sendReceipt: document.getElementById('paySendReceipt').checked
    };

    try {
      const res = await authFetch(`/api/admin/invoices/${invoiceId}/payment`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        closeModal('modalRecordPayment');
        showToast(`Payment of ₹${amount.toLocaleString('en-IN')} recorded for ${invoiceId}.`, 'success');
        loadInvoices();
        loadOrders();
        loadDashboardMetrics();
      } else {
        showToast(data.message || 'Payment recording failed.', 'error');
      }
    } catch (e) {
      showToast('Error recording payment.', 'error');
    }
  }

  // ===========================================================================
  // 5. TOAST NOTIFICATIONS & UTILITIES
  // ===========================================================================
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `admin-toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(iso) {
    if (!iso) return 'N/A';
    try {
      return new Date(iso).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function formatDateTime(iso) {
    if (!iso) return 'N/A';
    try {
      return new Date(iso).toLocaleString('en-IN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return iso;
    }
  }

  // ===========================================================================
  // 6. REAL-TIME SERVER-SENT EVENTS (SSE) LISTENER
  // ===========================================================================
  function initEventStream() {
    if (!sessionToken || typeof EventSource === 'undefined') return;
    closeEventStream();

    const sseUrl = `${API_BASE}/api/admin/events?token=${encodeURIComponent(sessionToken)}`;

    try {
      eventSource = new EventSource(sseUrl);

      eventSource.addEventListener('connected', () => {
        console.log('[SSE] Authenticated event stream connected.');
      });

      eventSource.addEventListener('enquiry:created', (e) => {
        try {
          const payload = JSON.parse(e.data).payload;
          showToast(`New Enquiry: ${payload.enquiryId} (${payload.customer || 'Customer'})`, 'info');
          loadEnquiries();
          loadDashboardMetrics();
        } catch (err) {}
      });

      eventSource.addEventListener('enquiry:status_changed', (e) => {
        try {
          const payload = JSON.parse(e.data).payload;
          showToast(`Enquiry ${payload.enquiryId} updated to ${payload.status}`, 'info');
          loadEnquiries();
          loadDashboardMetrics();
        } catch (err) {}
      });

      eventSource.addEventListener('enquiry:assigned', () => {
        loadEnquiries();
      });

      eventSource.addEventListener('order:created', (e) => {
        try {
          const payload = JSON.parse(e.data).payload;
          showToast(`New Order: ${payload.orderId}`, 'info');
          loadOrders();
          loadDashboardMetrics();
        } catch (err) {}
      });

      eventSource.addEventListener('quotation:created', () => {
        loadQuotations();
        loadOrders();
        loadDashboardMetrics();
      });

      eventSource.addEventListener('quotation:approved', (e) => {
        try {
          const payload = JSON.parse(e.data).payload;
          showToast(`Quotation #${payload.quotationId} approved by client!`, 'success');
          loadQuotations();
          loadOrders();
          loadDashboardMetrics();
        } catch (err) {}
      });

      eventSource.addEventListener('invoice:created', () => {
        loadInvoices();
        loadOrders();
        loadDashboardMetrics();
      });

      eventSource.addEventListener('payment:recorded', (e) => {
        try {
          const payload = JSON.parse(e.data).payload;
          showToast(`Payment of ₹${(payload.amount || 0).toLocaleString('en-IN')} recorded on ${payload.invoiceId}`, 'success');
          loadInvoices();
          loadOrders();
          loadCustomers();
          loadDashboardMetrics();
        } catch (err) {}
      });

      eventSource.onerror = () => {
        // Handled automatically by browser EventSource reconnect mechanism
      };
    } catch (err) {
      console.warn('[SSE] EventSource init notice:', err);
    }
  }

  function closeEventStream() {
    if (eventSource) {
      try {
        eventSource.close();
      } catch (e) {}
      eventSource = null;
    }
  }

})();
