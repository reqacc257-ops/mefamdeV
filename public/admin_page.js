function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAppDate(app) {
    const value = app?.date || app?.date_label || app?.dateLabel || app?.submittedAt || app?.submitted_at || app?.createdAt || app?.created_at || '';
    if (!value) return '—';
    const trimmed = String(value).trim();
    if (!trimmed) return '—';
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime()) && trimmed.includes('-')) {
        return parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return trimmed;
}

function statusBadge(status) {
    const map = {
        'Accepted': 'badge-green',
        'Interviewing': 'badge-orange',
        'Pending Review': 'badge-red',
    };
    return `<span class="badge ${map[status] || 'badge-grey'}">${escapeHtml(status || 'Unknown')}</span>`;
}

function parseCurrencyValue(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value).trim().replace(/[₱,\s]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value, suffix = '') {
    const parsed = parseCurrencyValue(value);
    if (parsed === null) return '—';
    return `₱${parsed.toLocaleString()}${suffix}`;
}

function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
}

function openApplicantPortal(appId) {
    const apps = JSON.parse(localStorage.getItem('mefamdev_apps') || '[]');
    const app = apps.find(a => String(a.id) === String(appId));
    if (!app) { alert('Application not found.'); return; }
    localStorage.setItem('mefamdev_preview_session', JSON.stringify({
        type: 'applicant',
        appId: app.id,
        name: app.name,
        loginTime: Date.now(),
        isAdminPreview: true,
        token: sessionStorage.getItem('mefamdev_token') || ''
    }));
    window.open('applicant_portal.html?preview=1', '_blank');
}

async function renderDocChecklist(appId, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '<p style="color:#aaa;font-size:.85rem;">Loading documents…</p>';
    let items;
    try {
        items = await MefamAPI.getDocuments(appId);
    } catch (e) {
        items = null;
    }
    if (!Array.isArray(items)) {
        el.innerHTML = '<p style="color:#c0392b;font-size:.85rem;">Could not load the document checklist right now.</p>';
        return;
    }
    const badgeFor = s => s === 'Received' ? 'badge-green' : s === 'Missing' ? 'badge-red' : 'badge-orange';
    const submittedCount = items.filter(d => d.status === 'Received').length;
    el.innerHTML = `
        <div style="font-size:.78rem; color:var(--text-muted); margin-bottom:8px;">
            ${submittedCount + 1} of ${items.length + 1} documents received
        </div>
        <table>
            <thead><tr><th>Document</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
                <tr>
                    <td>Application Form (Online)</td>
                    <td><span class="badge badge-green">Submitted</span></td>
                    <td>—</td>
                </tr>
                ${items.map(d => `
                <tr>
                    <td>${escapeHtml(d.label)}</td>
                    <td><span class="badge ${badgeFor(d.status)}">${escapeHtml(d.status)}</span></td>
                    <td style="font-size:.78rem; color:#c0392b; max-width:200px;">${escapeHtml(d.note || '—')}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}
