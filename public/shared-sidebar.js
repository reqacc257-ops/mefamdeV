/* Unified sidebar + skeleton screens for standalone MEFAMDEV admin pages. */
(function () {
    'use strict';

    const publicPages = ['index.html', 'applicant_portal.html', 'application_form.html', 'reset_password.html'];
    const currentFile = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (publicPages.includes(currentFile) || window.self !== window.top) return;

    let session = null;
    try {
        session = JSON.parse(sessionStorage.getItem('mefamdev_session') || 'null');
    } catch (error) {}
    if (!session || session.type !== 'staff') return;

    const role = String(session.role || 'director').toLowerCase();
    const displayName = session.name || 'Staff Member';
    const title = session.title || role.toUpperCase();
    const initials = session.initials || displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '??';
    const storageKey = 'mefamdev_sidebar_groups';

    const navGroups = [
        { id: 'overview', label: '📊 Overview', roles: ['director', 'edu', 'finance', 'program'], items: [
            { href: 'admin_dashboard.html', icon: '🏠', label: 'Dashboard', roles: ['director', 'edu', 'finance', 'program'] }
        ]},
        { id: 'intake', label: '📥 Intake & Programs', roles: ['director', 'program', 'edu'], items: [
            { href: 'admin_dashboard.html#submitted-apps', icon: '📨', label: 'Submitted Applications', roles: ['director', 'program'] },
            { href: 'admin_dashboard.html#pipeline', icon: '🔀', label: 'Application Status', roles: ['director', 'program'] },
            { href: 'staff_assessment.html', icon: '📝', label: 'Assessment Form', roles: ['director', 'program'] },
            { href: 'intake_sheet.html', icon: '📄', label: 'Intake Sheet', roles: ['director', 'program'] },
            { href: 'student_grade_card.html', icon: '🎓', label: 'Student Report Cards', roles: ['director', 'edu'] },
            { href: 'spiritual_formation.html', icon: '🕊️', label: 'Spiritual Formation', roles: ['director', 'edu', 'program'] }
        ]},
        { id: 'admin', label: '💼 Admin & Finance', roles: ['director', 'finance', 'program'], items: [
            { href: 'financials.html', icon: '💰', label: 'Financials', roles: ['director', 'finance'] },
            { href: 'mass_print.html', icon: '🖨️', label: 'Printing Area', roles: ['director', 'edu', 'finance', 'program'] },
            { href: 'admin_dashboard.html#settings', icon: '⚙️', label: 'Settings', roles: ['director'] }
        ]}
    ];

    /* ============================================================
       CSS — sidebar + skeleton overlay
       ============================================================ */
    const css = `
        :root { --mefam-sidebar-w: 260px; }
        body.mefam-has-sidebar { padding-left: var(--mefam-sidebar-w); }

        /* ---------- Sidebar ---------- */
        .mefam-sidebar { position:fixed; inset:0 auto 0 0; width:var(--mefam-sidebar-w); background:linear-gradient(180deg,#14273b,#1a2e44); display:flex; flex-direction:column; overflow-y:auto; z-index:200; border-right:1px solid rgba(255,255,255,.04); box-shadow:8px 0 24px rgba(15,23,42,.08); font-family:'DM Sans',Arial,sans-serif; }
        .mefam-sidebar-brand { padding:22px 18px 16px; border-bottom:1px solid rgba(255,255,255,.08); display:flex; align-items:center; gap:12px; }
        .mefam-sidebar-brand img { height:42px; object-fit:contain; filter:brightness(1.1); }
        .mefam-brand-text { line-height:1.3; min-width:0; }
        .mefam-brand-name { font-family:'DM Serif Display',Georgia,serif; color:#fff; font-size:1rem; }
        .mefam-brand-sub { font-size:.7rem; color:rgba(255,255,255,.55); letter-spacing:.03em; }
        .mefam-nav-group { margin:4px 0; }
        .mefam-nav-group-header { display:flex; align-items:center; justify-content:space-between; padding:12px 18px 4px; cursor:pointer; margin:0 8px; width:calc(100% - 16px); border:0; border-radius:6px; background:transparent; color:inherit; font:inherit; text-align:left; }
        .mefam-nav-group-header:hover { background:rgba(255,255,255,.04); }
        .mefam-nav-section-label { font-size:.66rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:rgba(255,255,255,.5); display:flex; align-items:center; gap:8px; }
        .mefam-nav-group-chevron { font-size:.7rem; color:rgba(255,255,255,.4); transform:rotate(90deg); transition:transform .2s; }
        .mefam-nav-group.collapsed .mefam-nav-group-chevron { transform:rotate(0); }
        .mefam-nav-group-items { overflow:hidden; max-height:2400px; opacity:1; transition:max-height .28s,opacity .18s; }
        .mefam-nav-group.collapsed .mefam-nav-group-items { max-height:0; opacity:0; }
        .mefam-nav-item { display:flex; align-items:center; gap:11px; padding:10px 18px; border-radius:7px; margin:2px 10px; cursor:pointer; font-size:.88rem; font-weight:500; color:rgba(255,255,255,.75); transition:background .15s,color .15s; width:calc(100% - 20px); background:transparent; border:0; font-family:inherit; text-decoration:none; }
        .mefam-nav-item:hover { background:rgba(255,255,255,.08); color:#fff; transform:translateX(2px); }
        .mefam-nav-item.active { background:#f5a623; color:#1a2e44; font-weight:700; box-shadow:0 4px 14px rgba(245,166,35,.25); }
        .mefam-nav-icon { width:24px; height:24px; border-radius:7px; display:grid; place-items:center; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); color:#fff; font-size:.9rem; flex-shrink:0; }
        .mefam-nav-item.active .mefam-nav-icon { background:rgba(26,46,68,.12); color:#1a2e44; }
        .mefam-sidebar-footer { margin-top:auto; padding:14px 18px; border-top:1px solid rgba(255,255,255,.08); }
        .mefam-user-box { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08); margin-bottom:10px; }
        .mefam-user-avatar { width:34px; height:34px; border-radius:50%; background:#f5a623; color:#1a2e44; display:grid; place-items:center; font-weight:700; flex-shrink:0; overflow:hidden; }
        .mefam-user-avatar img { width:100%; height:100%; object-fit:cover; }
        .mefam-user-info { min-width:0; }
        .mefam-user-name,.mefam-user-role { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .mefam-user-name { color:#fff; font-size:.82rem; font-weight:700; }
        .mefam-user-role { color:rgba(255,255,255,.55); font-size:.68rem; }
        .mefam-logout-btn { width:100%; padding:10px 14px; background:rgba(231,76,60,.15); color:#ff8a7a; border:1px solid rgba(231,76,60,.3); border-radius:7px; font-size:.82rem; font-weight:700; cursor:pointer; font-family:inherit; }
        .mefam-sidebar-backdrop { display:none; position:fixed; inset:0; background:rgba(5,12,23,.6); z-index:199; opacity:0; pointer-events:none; transition:opacity .2s; }
        .mefam-sidebar-backdrop.open { opacity:1; pointer-events:auto; }
        .mefam-sidebar-toggle { display:none; position:fixed; top:12px; left:12px; z-index:201; width:42px; height:42px; border:0; border-radius:10px; background:#1a2e44; color:#fff; font-size:1.15rem; cursor:pointer; }
        @media (max-width:900px) { body.mefam-has-sidebar { padding-left:0; padding-top:58px; } .mefam-sidebar { transform:translateX(-100%); width:min(84vw,300px); transition:transform .25s; } .mefam-sidebar.open { transform:translateX(0); } .mefam-sidebar-backdrop { display:block; } .mefam-sidebar-toggle { display:inline-flex; align-items:center; justify-content:center; } }
        @media print { .mefam-sidebar,.mefam-sidebar-toggle,.mefam-sidebar-backdrop,#mefamPageSkeleton { display:none!important; } body.mefam-has-sidebar { padding:0!important; } }

        /* ---------- Skeleton screen ---------- */
        #mefamPageSkeleton {
            position: fixed;
            inset: 0;
            z-index: 400;
            background: #eef2f7;
            padding: 26px 28px;
            overflow: hidden;
            opacity: 0;
            pointer-events: none;
            transition: opacity .22s ease;
            font-family: 'DM Sans', Arial, sans-serif;
        }
        #mefamPageSkeleton.is-visible {
            opacity: 1;
            pointer-events: auto;
        }
        body.mefam-skeleton-active { overflow: hidden; }

        .mefam-sk-shell { max-width: 1180px; margin: 0 auto; width: 100%; }
        .mefam-sk-line, .mefam-sk-block {
            background: linear-gradient(90deg, #e1e6ed 25%, #f4f6f9 50%, #e1e6ed 75%);
            background-size: 200% 100%;
            animation: mefamSkShimmer 1.35s ease-in-out infinite;
            border-radius: 8px;
        }
        @keyframes mefamSkShimmer {
            from { background-position: 200% 0; }
            to   { background-position: -200% 0; }
        }
        .mefam-sk-title    { width: 220px; height: 26px; margin-bottom: 10px; }
        .mefam-sk-sub      { width: 320px; height: 12px; margin-bottom: 26px; }
        .mefam-sk-grid     { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 22px; }
        .mefam-sk-block    { height: 112px; }
        .mefam-sk-block-lg { height: 280px; margin-bottom: 18px; }
        .mefam-sk-block-lg:last-child { margin-bottom: 0; }

        @media (max-width: 900px) {
            #mefamPageSkeleton { padding: 16px; padding-top: 74px; }
            .mefam-sk-grid { grid-template-columns: 1fr 1fr; }
            .mefam-sk-title { width: 160px; height: 22px; }
            .mefam-sk-sub { width: 220px; }
        }
        @media (prefers-reduced-motion: reduce) {
            .mefam-sk-line, .mefam-sk-block { animation: none; }
            #mefamPageSkeleton { transition: none; }
        }
    `;

    /* ============================================================
       Sidebar markup
       ============================================================ */
    function buildHtml() {
        const groups = navGroups.filter(group => group.roles.includes(role)).map(group => {
            const items = group.items.filter(item => item.roles.includes(role));
            if (!items.length) return '';
            return `<div class="mefam-nav-group" data-group="${group.id}">
                <button type="button" class="mefam-nav-group-header" data-group-toggle="${group.id}" aria-expanded="true"><span class="mefam-nav-section-label">${group.label}</span><span class="mefam-nav-group-chevron">▸</span></button>
                <div class="mefam-nav-group-items">${items.map(item => `<a class="mefam-nav-item" href="${item.href}" data-href="${item.href}"><span class="mefam-nav-icon">${item.icon}</span><span>${item.label}</span></a>`).join('')}</div>
            </div>`;
        }).join('');
        return `<aside class="mefam-sidebar" id="mefamSidebar" aria-label="Main navigation">
            <div class="mefam-sidebar-brand"><img src="mefamdev.png" alt="MEFAMDEV Logo" onerror="this.style.display='none'"><div class="mefam-brand-text"><div class="mefam-brand-name">MEFAMDEV-Life</div><div class="mefam-brand-sub">Angat, Bulacan Chapter</div></div></div>
            <nav aria-label="Primary">${groups}</nav>
            <div class="mefam-sidebar-footer"><div class="mefam-user-box"><div class="mefam-user-avatar" id="mefamUserAvatar">${initials}</div><div class="mefam-user-info"><div class="mefam-user-name">${displayName}</div><div class="mefam-user-role">${title}</div></div></div><button type="button" class="mefam-logout-btn" data-sidebar-logout>⎋ Sign Out</button></div>
        </aside><div class="mefam-sidebar-backdrop" id="mefamSidebarBackdrop"></div><button type="button" class="mefam-sidebar-toggle" id="mefamSidebarToggle" aria-label="Toggle navigation">☰</button>`;
    }

    /* ============================================================
       Skeleton screen
       ============================================================ */
    const SKELETON_ID = 'mefamPageSkeleton';
    let skeletonFirstShownAt = 0;
    const SKELETON_MIN_MS = 220;

    function buildSkeletonHtml() {
        return `<div class="mefam-sk-shell">
            <div class="mefam-sk-line mefam-sk-title"></div>
            <div class="mefam-sk-line mefam-sk-sub"></div>
            <div class="mefam-sk-grid">
                <div class="mefam-sk-block"></div>
                <div class="mefam-sk-block"></div>
                <div class="mefam-sk-block"></div>
                <div class="mefam-sk-block"></div>
            </div>
            <div class="mefam-sk-block mefam-sk-block-lg"></div>
            <div class="mefam-sk-block mefam-sk-block-lg"></div>
        </div>`;
    }

    function ensureSkeleton() {
        let el = document.getElementById(SKELETON_ID);
        if (el) return el;
        if (!document.body) return null;
        el = document.createElement('div');
        el.id = SKELETON_ID;
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = buildSkeletonHtml();
        document.body.appendChild(el);
        return el;
    }

    function showSkeleton() {
        const el = ensureSkeleton();
        if (!el) return;
        if (!el.classList.contains('is-visible')) {
            skeletonFirstShownAt = performance.now();
            el.classList.add('is-visible');
            document.body.classList.add('mefam-skeleton-active');
        }
    }

    function hideSkeleton() {
        const el = document.getElementById(SKELETON_ID);
        if (!el) return;
        const elapsed = performance.now() - skeletonFirstShownAt;
        const remaining = Math.max(0, SKELETON_MIN_MS - elapsed);
        setTimeout(() => {
            el.classList.remove('is-visible');
            document.body.classList.remove('mefam-skeleton-active');
            setTimeout(() => el.remove(), 260);
        }, remaining);
    }

    /** Show the skeleton during the very first paint of this page. */
    function startSkeletonLifecycle() {
        showSkeleton();
        const finish = () => hideSkeleton();
        if (document.readyState === 'complete') {
            finish();
        } else {
            window.addEventListener('load', finish, { once: true });
            // Safety net — never leave the user stuck behind the skeleton.
            setTimeout(finish, 6000);
        }
    }

    /* ============================================================
       Sidebar API
       ============================================================ */
    const api = {
        toggle() { const sidebar = document.getElementById('mefamSidebar'); const backdrop = document.getElementById('mefamSidebarBackdrop'); const open = sidebar?.classList.toggle('open'); backdrop?.classList.toggle('open', open); },
        close() { document.getElementById('mefamSidebar')?.classList.remove('open'); document.getElementById('mefamSidebarBackdrop')?.classList.remove('open'); },
        logout() { if (!confirm('Sign out of the admin dashboard?')) return; if (window.MefamAPI?.logout) return window.MefamAPI.logout(); sessionStorage.clear(); localStorage.removeItem('mefamdev_preview_session'); window.location.href = 'index.html'; },
        highlight() { const path = (window.location.pathname.split('/').pop() || '').toLowerCase(); const hash = window.location.hash || ''; let matched = false; document.querySelectorAll('.mefam-nav-item').forEach(link => { const href = link.dataset.href.toLowerCase(); const active = href === path || (href.includes('#') && href === path + hash); link.classList.toggle('active', active); matched ||= active; }); if (!matched) document.querySelector('.mefam-nav-item[data-href="admin_dashboard.html"]')?.classList.add('active'); }
    };

    window.MefamSidebar = api;

    function init() {
        if (document.getElementById('mefamSidebar')) return;
        const style = document.createElement('style'); style.id = 'mefam-sidebar-styles'; style.textContent = css; document.head.appendChild(style);
        document.body.classList.add('mefam-has-sidebar');
        const wrapper = document.createElement('div'); wrapper.innerHTML = buildHtml(); while (wrapper.firstElementChild) document.body.insertBefore(wrapper.firstElementChild, document.body.firstChild);
        document.querySelectorAll('.app-sidebar,.sidebar,.sidebar-backdrop,.app-menu-toggle,#sidebar,#sidebarBackdrop,#menuToggle').forEach(element => { element.style.display = 'none'; });
        const state = JSON.parse(localStorage.getItem(storageKey) || '{}');
        document.querySelectorAll('[data-group-toggle]').forEach(header => { header.addEventListener('click', () => { const group = header.closest('.mefam-nav-group'); const collapsed = group.classList.toggle('collapsed'); header.setAttribute('aria-expanded', String(!collapsed)); const next = JSON.parse(localStorage.getItem(storageKey) || '{}'); next[header.dataset.groupToggle] = collapsed; localStorage.setItem(storageKey, JSON.stringify(next)); }); if (state[header.dataset.groupToggle]) { header.click(); } });
        document.getElementById('mefamSidebarToggle')?.addEventListener('click', api.toggle);
        document.getElementById('mefamSidebarBackdrop')?.addEventListener('click', api.close);
        document.querySelector('[data-sidebar-logout]')?.addEventListener('click', api.logout);
        document.querySelectorAll('.mefam-nav-item').forEach(link => link.addEventListener('click', () => {
            showSkeleton();
            if (window.innerWidth <= 900) api.close();
        }));
        api.highlight();
        window.addEventListener('hashchange', api.highlight);
        startSkeletonLifecycle();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
