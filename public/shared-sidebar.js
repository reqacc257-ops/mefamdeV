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
    const collapsedStorageKey = 'mefamdev_sidebar_collapsed';
    
    // Load collapsed state from localStorage
    let isCollapsed = localStorage.getItem(collapsedStorageKey) === 'true';

    const navGroups = [
        { id: 'overview', label: 'Main', roles: ['director', 'edu', 'finance', 'program'], items: [
            { href: 'admin_dashboard.html', icon: '📊', label: 'Dashboard', desc: 'Overview & analytics', roles: ['director', 'edu', 'finance', 'program'] }
        ]},
        { id: 'scholars', label: 'Scholars & Programs', roles: ['director', 'program', 'edu'], items: [
            { href: 'admin_dashboard.html#submitted-apps', icon: '📨', label: 'Applications', desc: 'New submissions', roles: ['director', 'program'] },
            { href: 'admin_dashboard.html#pipeline', icon: '🔄', label: 'Pipeline', desc: 'Status tracking', roles: ['director', 'program'] },
            { href: 'student_grade_card.html', icon: '📈', label: 'Grades', desc: 'Grade tracking', roles: ['director', 'edu'] },
            { href: 'spiritual_formation.html', icon: '✨', label: 'Formation', desc: 'Events & attendance', roles: ['director', 'edu', 'program'] }
        ]},
        { id: 'operations', label: 'Operations', roles: ['director', 'finance', 'program'], items: [
            { href: 'staff_assessment.html', icon: '📝', label: 'Assessment', desc: 'Staff evaluations', roles: ['director', 'program'] },
            { href: 'intake_sheet.html', icon: '📋', label: 'Intake', desc: 'Intake forms', roles: ['director', 'program'] },
            { href: 'mass_print.html', icon: '🖨️', label: 'Printing', desc: 'Bulk printing', roles: ['director', 'edu', 'finance', 'program'] },
            { href: 'financials.html', icon: '💰', label: 'Financials', desc: 'Financial reports', roles: ['director', 'finance'] },
            { href: 'admin_dashboard.html#settings', icon: '⚙️', label: 'Settings', desc: 'Configuration', roles: ['director'] }
        ]}
    ];

    /* ============================================================
       CSS — sidebar + skeleton overlay
       ============================================================ */
    const css = `
        :root { --mefam-sidebar-w: 280px; --mefam-sidebar-collapsed-w: 80px; --mefam-primary: #1a2e44; --mefam-accent: #f5a623; --mefam-hover: rgba(255,255,255,.08); }
        body.mefam-has-sidebar { padding-left: var(--mefam-sidebar-w); transition: padding-left .3s; }
        body.mefam-has-sidebar.mefam-sidebar-collapsed { padding-left: var(--mefam-sidebar-collapsed-w); }

        /* ---------- Sidebar Container ---------- */
        .mefam-sidebar {
            position: fixed;
            inset: 0 auto 0 0;
            width: var(--mefam-sidebar-w);
            background: linear-gradient(180deg, #0f1e30 0%, #1a2e44 50%, #14273b 100%);
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            overflow-x: hidden;
            z-index: 200;
            border-right: 1px solid rgba(255, 255, 255, .06);
            box-shadow: 12px 0 32px rgba(15, 23, 42, .15);
            font-family: 'Inter', -apple-system, sans-serif;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, .1) transparent;
            transition: width .3s cubic-bezier(.4, 0, .2, 1);
        }
        .mefam-sidebar.collapsed {
            width: var(--mefam-sidebar-collapsed-w);
        }
        .mefam-sidebar::-webkit-scrollbar { width: 6px; }
        .mefam-sidebar::-webkit-scrollbar-track { background: transparent; }
        .mefam-sidebar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, .1); border-radius: 3px; }
        .mefam-sidebar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, .15); }

        /* ---------- Brand/Logo Area ---------- */
        .mefam-sidebar-brand {
            padding: 20px 16px 18px;
            border-bottom: 1px solid rgba(255, 255, 255, .06);
            display: flex;
            align-items: center;
            gap: 10px;
            flex-shrink: 0;
            background: rgba(255, 255, 255, .01);
            position: relative;
        }
        .mefam-sidebar.collapsed .mefam-sidebar-brand {
            padding: 16px 12px;
            justify-content: center;
            flex-direction: column;
        }
        .mefam-sidebar-brand img {
            height: 38px;
            object-fit: contain;
            filter: brightness(1.15);
        }
        .mefam-sidebar.collapsed .mefam-sidebar-brand img {
            height: 32px;
        }
        .mefam-brand-text {
            line-height: 1.2;
            min-width: 0;
            flex: 1;
        }
        .mefam-sidebar.collapsed .mefam-brand-text {
            display: none;
        }
        .mefam-brand-name {
            font-family: 'DM Serif Display', Georgia, serif;
            color: #fff;
            font-size: .95rem;
            font-weight: 700;
            margin: 0;
            letter-spacing: -.02em;
        }
        .mefam-brand-sub {
            font-size: .65rem;
            color: rgba(255, 255, 255, .45);
            letter-spacing: .04em;
            text-transform: uppercase;
        }

        /* ---------- Collapse Toggle Button ---------- */
        .mefam-collapse-btn {
            position: absolute;
            right: 8px;
            top: 18px;
            width: 28px;
            height: 28px;
            border: 0;
            border-radius: 6px;
            background: rgba(255, 255, 255, .08);
            color: rgba(255, 255, 255, .6);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: .9rem;
            transition: all .2s;
            flex-shrink: 0;
            padding: 0;
            font-family: inherit;
        }
        .mefam-collapse-btn:hover {
            background: rgba(255, 255, 255, .12);
            color: #fff;
            transform: scale(1.08);
        }
        .mefam-sidebar.collapsed .mefam-collapse-btn {
            position: static;
            right: auto;
            width: calc(100% - 16px);
            height: 44px;
            margin: 0 8px 8px 8px;
            border-radius: 8px;
            background: rgba(245, 166, 35, .1);
            color: var(--mefam-accent);
            font-size: 1rem;
        }
        .mefam-sidebar.collapsed .mefam-collapse-btn:hover {
            background: rgba(245, 166, 35, .15);
        }

        /* ---------- Navigation Groups ---------- */
        .mefam-nav-group {
            margin: 8px 0;
            flex-shrink: 0;
        }
        .mefam-nav-group-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px 6px;
            cursor: pointer;
            margin: 0;
            width: 100%;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            transition: all .2s;
            position: relative;
        }
        .mefam-sidebar.collapsed .mefam-nav-group-header {
            display: none;
        }
        .mefam-nav-group-header:hover {
            background: rgba(255, 255, 255, .03);
            padding-left: 18px;
        }
        .mefam-nav-section-label {
            font-size: .7rem;
            font-weight: 800;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, .4);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .mefam-nav-group-chevron {
            font-size: .65rem;
            color: rgba(255, 255, 255, .3);
            transform: rotate(0deg);
            transition: transform .25s cubic-bezier(.4, 0, .2, 1);
            display: inline-block;
        }
        .mefam-nav-group:not(.collapsed) .mefam-nav-group-chevron {
            transform: rotate(-90deg);
        }

        /* ---------- Navigation Items Container ---------- */
        .mefam-nav-group-items {
            overflow: hidden;
            max-height: 2400px;
            opacity: 1;
            transition: max-height .3s cubic-bezier(.4, 0, .2, 1), opacity .2s linear;
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding: 4px 0;
        }
        .mefam-sidebar.collapsed .mefam-nav-group-items {
            padding: 4px 8px;
            max-height: 2400px;
            opacity: 1;
            gap: 6px;
            flex-wrap: wrap;
            flex-direction: row;
            justify-content: center;
        }
        .mefam-nav-group.collapsed .mefam-nav-group-items {
            max-height: 0;
            opacity: 0;
            pointer-events: none;
        }
        .mefam-sidebar.collapsed .mefam-nav-group.collapsed .mefam-nav-group-items {
            max-height: 2400px;
            opacity: 1;
            pointer-events: auto;
        }

        /* ---------- Individual Navigation Items ---------- */
        .mefam-nav-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 11px 16px 11px 12px;
            margin: 0;
            cursor: pointer;
            font-size: .86rem;
            font-weight: 500;
            line-height: 1.3;
            color: rgba(255, 255, 255, .7);
            transition: all .2s;
            width: 100%;
            background: transparent;
            border: 0;
            font-family: inherit;
            text-decoration: none;
            position: relative;
            overflow: hidden;
        }
        .mefam-sidebar.collapsed .mefam-nav-item {
            width: auto;
            gap: 0;
            padding: 8px;
            justify-content: center;
            border-radius: 8px;
            position: relative;
            min-width: 44px;
            min-height: 44px;
        }
        .mefam-nav-item::before {
            content: '';
            position: absolute;
            left: 0;
            top: 0;
            width: 3px;
            height: 100%;
            background: transparent;
            transition: all .2s;
        }
        .mefam-sidebar.collapsed .mefam-nav-item::before {
            display: none;
        }
        .mefam-nav-item:hover {
            background: rgba(255, 255, 255, .06);
            color: #fff;
            padding-left: 14px;
        }
        .mefam-sidebar.collapsed .mefam-nav-item:hover {
            background: rgba(245, 166, 35, .15);
            padding-left: 8px;
        }
        .mefam-nav-item.active {
            background: rgba(245, 166, 35, .15);
            color: var(--mefam-accent);
            font-weight: 700;
            border-left: 3px solid var(--mefam-accent);
            padding-left: 13px;
        }
        .mefam-sidebar.collapsed .mefam-nav-item.active {
            background: rgba(245, 166, 35, .2);
            border-left: 0;
            border-radius: 8px;
            padding-left: 8px;
        }
        .mefam-nav-item.active::before {
            background: var(--mefam-accent);
            width: 3px;
        }

        /* ---------- Nav Item Content ---------- */
        .mefam-nav-icon {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            display: grid;
            place-items: center;
            background: rgba(255, 255, 255, .08);
            color: #fff;
            font-size: 1rem;
            flex-shrink: 0;
            transition: all .2s;
            border: 1px solid rgba(255, 255, 255, .1);
        }
        .mefam-sidebar.collapsed .mefam-nav-icon {
            width: 36px;
            height: 36px;
            font-size: 1.2rem;
            border-radius: 8px;
            margin: 0 auto;
        }
        .mefam-nav-item:hover .mefam-nav-icon {
            background: rgba(245, 166, 35, .15);
            border-color: rgba(245, 166, 35, .3);
        }
        .mefam-nav-item.active .mefam-nav-icon {
            background: rgba(245, 166, 35, .2);
            border-color: var(--mefam-accent);
        }
        .mefam-nav-label {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .mefam-sidebar.collapsed .mefam-nav-label {
            display: none;
        }
        .mefam-nav-label-main {
            font-weight: 600;
            color: inherit;
        }
        .mefam-nav-label-desc {
            font-size: .72rem;
            color: rgba(255, 255, 255, .4);
            opacity: 0;
            max-height: 0;
            overflow: hidden;
            transition: opacity .2s, max-height .2s;
        }
        .mefam-nav-item:hover .mefam-nav-label-desc {
            opacity: 1;
            max-height: 20px;
        }

        /* ---------- Sidebar Footer ---------- */
        .mefam-sidebar-footer {
            margin-top: auto;
            padding: 14px 12px;
            border-top: 1px solid rgba(255, 255, 255, .06);
            flex-shrink: 0;
            background: rgba(255, 255, 255, .01);
        }
        .mefam-sidebar.collapsed .mefam-sidebar-footer {
            padding: 8px 8px;
        }
        .mefam-user-box {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px;
            border-radius: 9px;
            background: rgba(255, 255, 255, .05);
            border: 1px solid rgba(255, 255, 255, .08);
            margin-bottom: 10px;
            transition: all .2s;
        }
        .mefam-sidebar.collapsed .mefam-user-box {
            padding: 8px;
            margin-bottom: 8px;
            justify-content: center;
        }
        .mefam-user-box:hover {
            background: rgba(255, 255, 255, .08);
        }
        .mefam-user-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--mefam-accent), #f5a623);
            color: var(--mefam-primary);
            display: grid;
            place-items: center;
            font-weight: 700;
            font-size: .85rem;
            flex-shrink: 0;
            overflow: hidden;
            box-shadow: 0 2px 6px rgba(245, 166, 35, .2);
        }
        .mefam-user-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .mefam-user-info {
            min-width: 0;
            flex: 1;
        }
        .mefam-sidebar.collapsed .mefam-user-info {
            display: none;
        }
        .mefam-user-name,
        .mefam-user-role {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .mefam-user-name {
            color: #fff;
            font-size: .81rem;
            font-weight: 700;
            margin: 0;
        }
        .mefam-user-role {
            color: rgba(255, 255, 255, .5);
            font-size: .7rem;
            margin: 2px 0 0;
        }
        .mefam-logout-btn {
            width: 100%;
            padding: 9px 12px;
            background: rgba(231, 76, 60, .12);
            color: #ff8a7a;
            border: 1px solid rgba(231, 76, 60, .25);
            border-radius: 7px;
            font-size: .8rem;
            font-weight: 700;
            cursor: pointer;
            font-family: inherit;
            transition: all .2s;
        }
        .mefam-sidebar.collapsed .mefam-logout-btn {
            width: calc(100% - 16px);
            margin: 0 8px;
            padding: 8px 12px;
            font-size: .75rem;
        }
        .mefam-logout-btn:hover {
            background: rgba(231, 76, 60, .2);
            border-color: rgba(231, 76, 60, .4);
            transform: translateY(-1px);
        }

        /* ---------- Backdrop & Mobile ---------- */
        .mefam-sidebar-backdrop {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(5, 12, 23, .65);
            z-index: 199;
            opacity: 0;
            pointer-events: none;
            transition: opacity .25s;
            backdrop-filter: blur(4px);
        }
        .mefam-sidebar-backdrop.open {
            opacity: 1;
            pointer-events: auto;
        }
        .mefam-sidebar-toggle {
            display: none;
            position: fixed;
            top: 14px;
            left: 14px;
            z-index: 201;
            width: 44px;
            height: 44px;
            border: 0;
            border-radius: 10px;
            background: rgba(26, 46, 68, .95);
            color: #fff;
            font-size: 1.2rem;
            cursor: pointer;
            transition: all .2s;
            box-shadow: 0 4px 12px rgba(15, 23, 42, .2);
        }
        .mefam-sidebar-toggle:hover {
            background: rgba(26, 46, 68, 1);
            transform: scale(1.05);
        }

        @media (max-width: 900px) {
            body.mefam-has-sidebar {
                padding-left: 0;
                padding-top: 60px;
            }
            .mefam-sidebar {
                width: min(85vw, 320px);
                transform: translateX(-100%);
                transition: transform .3s cubic-bezier(.4, 0, .2, 1);
                height: calc(100vh - 60px);
                top: 60px;
            }
            .mefam-sidebar.open {
                transform: translateX(0);
            }
            .mefam-sidebar-backdrop {
                display: block;
            }
            .mefam-sidebar-toggle {
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
        }
        @media print {
            .mefam-sidebar,
            .mefam-sidebar-toggle,
            .mefam-sidebar-backdrop,
            #mefamPageSkeleton {
                display: none !important;
            }
            body.mefam-has-sidebar {
                padding: 0 !important;
            }
        }
`;
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
                <div class="mefam-nav-group-items">${items.map(item => `<a class="mefam-nav-item" href="${item.href}" data-href="${item.href}" title="${item.desc || item.label}"><span class="mefam-nav-icon">${item.icon}</span><span class="mefam-nav-label"><span class="mefam-nav-label-main">${item.label}</span><span class="mefam-nav-label-desc">${item.desc || ''}</span></span></a>`).join('')}</div></div>`;
        }).join('');
        const collapsedClass = isCollapsed ? ' collapsed' : '';
        return `<aside class="mefam-sidebar${collapsedClass}" id="mefamSidebar" aria-label="Main navigation">
            <div class="mefam-sidebar-brand"><img src="mefamdev.png" alt="MEFAMDEV Logo" onerror="this.style.display='none'"><div class="mefam-brand-text"><div class="mefam-brand-name">MEFAMDEV-Life</div><div class="mefam-brand-sub">Angat, Bulacan</div></div><button type="button" class="mefam-collapse-btn" title="Toggle sidebar" aria-label="Toggle sidebar" data-collapse-toggle>${isCollapsed ? '»' : '«'}</button></div>
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
        toggleCollapse() { const sidebar = document.getElementById('mefamSidebar'); const btn = document.querySelector('[data-collapse-toggle]'); const collapsed = sidebar?.classList.toggle('collapsed'); if (btn) btn.textContent = collapsed ? '»' : '«'; isCollapsed = collapsed; localStorage.setItem(collapsedStorageKey, String(collapsed)); document.body.classList.toggle('mefam-sidebar-collapsed', collapsed); },
        highlight() { const path = (window.location.pathname.split('/').pop() || '').toLowerCase(); const hash = window.location.hash || ''; let matched = false; document.querySelectorAll('.mefam-nav-item').forEach(link => { const href = link.dataset.href.toLowerCase(); const active = href === path || (href.includes('#') && href === path + hash); link.classList.toggle('active', active); matched ||= active; }); if (!matched) document.querySelector('.mefam-nav-item[data-href="admin_dashboard.html"]')?.classList.add('active'); }
    };

    window.MefamSidebar = api;

    function init() {
        if (document.getElementById('mefamSidebar')) return;
        const style = document.createElement('style'); style.id = 'mefam-sidebar-styles'; style.textContent = css; document.head.appendChild(style);
        document.body.classList.add('mefam-has-sidebar');
        if (isCollapsed) document.body.classList.add('mefam-sidebar-collapsed');
        const wrapper = document.createElement('div'); wrapper.innerHTML = buildHtml(); while (wrapper.firstElementChild) document.body.insertBefore(wrapper.firstElementChild, document.body.firstChild);
        document.querySelectorAll('.app-sidebar,.sidebar,.sidebar-backdrop,.app-menu-toggle,#sidebar,#sidebarBackdrop,#menuToggle').forEach(element => { element.style.display = 'none'; });
        const state = JSON.parse(localStorage.getItem(storageKey) || '{}');
        document.querySelectorAll('[data-group-toggle]').forEach(header => { header.addEventListener('click', () => { const group = header.closest('.mefam-nav-group'); const collapsed = group.classList.toggle('collapsed'); header.setAttribute('aria-expanded', String(!collapsed)); const next = JSON.parse(localStorage.getItem(storageKey) || '{}'); next[header.dataset.groupToggle] = collapsed; localStorage.setItem(storageKey, JSON.stringify(next)); }); if (state[header.dataset.groupToggle]) { header.click(); } });
        document.getElementById('mefamSidebarToggle')?.addEventListener('click', api.toggle);
        document.getElementById('mefamSidebarBackdrop')?.addEventListener('click', api.close);
        document.querySelector('[data-sidebar-logout]')?.addEventListener('click', api.logout);
        document.querySelector('[data-collapse-toggle]')?.addEventListener('click', api.toggleCollapse);
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
