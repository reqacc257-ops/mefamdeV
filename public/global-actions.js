document.addEventListener('DOMContentLoaded', () => {
    if (window.self !== window.top) return;
    const current = window.location.pathname.split('/').pop().toLowerCase();
    const container = document.createElement('div');
    container.id = 'globalActions';
    container.style.position = 'fixed';
    container.style.bottom = '18px';
    container.style.left = '18px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';

    const css = document.createElement('style');
    css.innerHTML = `
    #globalActions .ga-btn{display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-weight:700;font-family:inherit}
    #globalActions .ga-back{background:transparent;border:1px solid rgba(15,33,48,.08);color:#0f2130}
    @media print{#globalActions{display:none!important}}`;
    document.head.appendChild(css);

    // Back to dashboard (show when not on dashboard)
    if (!current || current.indexOf('admin_dashboard.html') === -1 && current.indexOf('admin_dashboard') === -1) {
        const back = document.createElement('button');
        back.className = 'ga-btn ga-back';
        back.innerHTML = '← Back to dashboard';
        back.title = 'Back to dashboard';
        back.onclick = () => { window.location.href = 'admin_dashboard.html'; };
        container.appendChild(back);
    }

    document.body.appendChild(container);
});
