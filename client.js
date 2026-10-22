// Client half of the dsh-chat-width bundle.
//
// The stock Conversation declares two variables on its body element:
//   --dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width,0px) * .64), 920px));
//   --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
// Chat rows read the first one; the composer card, its queue and the hero read the second. This plugin
// keeps the two independently adjustable, in PIXELS.
//
// Why pixels and not percentages: --dsh-composer-card-max-width is consumed at several nesting levels
// (composerHero width -> HeroShell stack -> composer card), so a percentage would be re-resolved
// against each smaller containing block and the card would shrink away from the hero chrome that
// aligns the workspace chips. A px value is substituted once, so every consumer sees the same width.
//
// Placement rules (each targets the element that already owns the variable, so no hashed class name
// is referenced and an inline value the host writes on that same element still wins):
// - content: the Conversation root, div:has(> [data-conversation-content]) — the element carrying the
//   host's inline --dsh-conversation-column-width, hence where `var(...)` is readable, and where the
//   built-in edge drag writes its own inline override (that still fine-tunes within the page).
// - composer: the Conversation body, div:has(> [data-conversation-scroll]) minus the embedded variant.
//
// Both widths stay bounded by the live column width, so the layout still adapts to window/sidebar
// changes without any JS measurement or resize loop.
window.__ModuleLoader__.load({
  id: '@ray666/dsh-chat-width',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this plugin (also registered as bundle meta via ./locale/*.json). */
    const NS = 'chatWidth';
    /** Stored widths, in CSS pixels. Absent = stock behavior for that row. */
    const CONTENT_KEY = 'dsh-chat-width.contentPx';
    const COMPOSER_KEY = 'dsh-chat-width.composerPx';
    /** Keys written by pre-release builds (percent based); removed on first run. */
    const LEGACY_KEYS = [
      'dsh-chat-width.content',
      'dsh-chat-width.composer',
      '@local/chat-width.content',
      '@local/chat-width.ratio',
    ];
    /** Host's own drag memory, taken over while this plugin is installed. */
    const HOST_PREF_KEY = 'dsh.conversation.contentWidth';
    /** Last measured column width, for settings rows opened while the conversation is unmounted. */
    const COL_CACHE_KEY = 'dsh-chat-width.col';
    const STYLE_ID = 'dsh-chat-width/style';

    /** Smallest width either row offers; equals the host's own clamp floor. */
    const PX_MIN = 680;
    /** Edge budget kept beside the chat column (the built-in drag handles live there). */
    const CONTENT_EDGE_PX = 176;
    /**
     * Edge budget kept beside the composer card. Deliberately the SAME budget as the chat column,
     * not the composer's own 32px clearances: the two widths must shrink inside the identical range
     * (column − 176px), otherwise on a narrow window the composer keeps 144px more slack than the
     * chat column and their stored size relationship inverts (wide: chat > composer; narrow: the
     * reverse). One shared budget makes the relationship stable at every window size.
     */
    const COMPOSER_EDGE_PX = CONTENT_EDGE_PX;
    /** The host links the composer to the chat column with this fixed gap. */
    const COMPOSER_GAP_PX = 32;
    /** Range used before any column width has been measured. */
    const FALLBACK_COLUMN_PX = 1600;

    /** The Conversation body (direct scroll child); the embedded variant is excluded. */
    const BODY_SELECTOR = 'div:has(> [data-conversation-scroll]):not([class*="embeddedBody"])';
    /** The Conversation root: the body's parent, where the host publishes its column width. */
    const CONTENT_ROOT_SELECTOR = ':has(> [data-conversation-content])';
    /** The host-published column width in px; 0px before the first measurement. */
    const COLUMN_VAR = 'var(--dsh-conversation-column-width, 0px)';

    /**
     * Read one stored width in px.
     * @param {string} key - the localStorage key.
     * @returns {number|null} pixels, or null when absent/invalid.
     */
    function readPx(key) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return null;
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) return null;
        return Math.round(value);
      } catch {
        return null;
      }
    }

    /**
     * Forget values stored by pre-release builds, so their percent semantics cannot resurface.
     */
    function dropLegacyKeys() {
      try {
        for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
      } catch {}
    }

    /**
     * The live column width in px, falling back to the last value seen while the conversation was
     * mounted (the Settings view unmounts it, which would otherwise leave nothing to measure).
     * @returns {number} column width in px, 0 when never measured.
     */
    function measuredColumn() {
      let live = 0;
      try {
        for (const node of document.querySelectorAll(CONTENT_ROOT_SELECTOR)) {
          const value = parseFloat(getComputedStyle(node).getPropertyValue('--dsh-conversation-column-width'));
          if (Number.isFinite(value) && value > 0) {
            live = value;
            break;
          }
        }
      } catch {}
      if (live > 0) {
        try {
          window.localStorage.setItem(COL_CACHE_KEY, String(Math.round(live)));
        } catch {}
        return live;
      }
      try {
        const cached = Number(window.localStorage.getItem(COL_CACHE_KEY));
        if (Number.isFinite(cached) && cached > 0) return cached;
      } catch {}
      return 0;
    }

    /**
     * Column width used for slider bounds, with a stand-in before the first measurement.
     * @returns {number} px.
     */
    function rangeColumn() {
      return measuredColumn() || FALLBACK_COLUMN_PX;
    }

    /**
     * The width a page without this plugin shows for the chat column: clamp(680px, col * .64, 920px).
     * @returns {number} px, 0 when never measured.
     */
    function stockContentPx() {
      const col = measuredColumn();
      if (col <= 0) return 0;
      return Math.round(Math.max(680, Math.min(col * 0.64, 920)));
    }

    /**
     * Widen the live column width while the plugin is installed: the copy of it that lives only in
     * memory would otherwise go stale when the page is reopened.
     */
    function watchColumn() {
      let tries = 0;
      const tick = () => {
        measuredColumn();
        tries += 1;
        if (tries < 12) window.setTimeout(tick, 500);
      };
      tick();
      window.addEventListener('resize', () => {
        measuredColumn();
      });
    }

    /**
     * Content state. "stock" means the row is untouched and nothing is injected.
     * @returns {{ stock: boolean, px: number }} px is the width shown by the setting row.
     */
    function readContent() {
      const stored = readPx(CONTENT_KEY);
      if (stored === null) return { stock: true, px: stockContentPx() || PX_MIN };
      return { stock: false, px: stored };
    }

    /**
     * Composer state. "follow" keeps the host link (chat column + 32px) and injects nothing.
     * @returns {{ follow: boolean, px: number }} px is the width shown by the setting row.
     */
    function readComposer() {
      const stored = readPx(COMPOSER_KEY);
      if (stored === null) {
        const content = readContent();
        return { follow: true, px: (content.stock ? stockContentPx() : content.px) + COMPOSER_GAP_PX };
      }
      return { follow: false, px: stored };
    }

    /**
     * A custom-property value that keeps a fixed pixel width inside the live column.
     * @param {number} px - desired width.
     * @param {number} edge - edge budget kept beside it.
     * @returns {string} the CSS expression.
     */
    function widthExpr(px, edge) {
      return 'max(' + PX_MIN + 'px, min(' + Math.round(px) + 'px, calc(' + COLUMN_VAR + ' - ' + edge + 'px)))';
    }

    /**
     * Clamp a candidate width into the range that still fits beside the edge budget.
     * @param {number} px - candidate width.
     * @param {number} edge - edge budget kept beside it.
     * @returns {number} the clamped width.
     */
    function clampPx(px, edge) {
      const max = Math.max(PX_MIN, Math.round(rangeColumn() - edge));
      return Math.min(max, Math.max(PX_MIN, Math.round(px)));
    }

    /**
     * Drop the host's built-in drag memory and its inline override so the rows stay authoritative.
     * Done even while both rows are at their default, so "default" really is the stock page.
     */
    function clearHostOverride() {
      try {
        window.localStorage.removeItem(HOST_PREF_KEY);
      } catch {}
      const nodes = document.querySelectorAll('[style*="--dsh-conversation-column-width"]');
      for (const node of nodes) node.style.removeProperty('--dsh-chat-user-width');
    }

    /**
     * Rewrite the plugin stylesheet: the two width rules plus the setting-row styles.
     */
    function applyStyles() {
      let style = document.getElementById(STYLE_ID);
      if (style === null) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        style.dataset.plugin = 'dsh-chat-width';
        document.head.appendChild(style);
      }
      clearHostOverride();
      const content = readContent();
      const composer = readComposer();
      const contentRule = content.stock
        ? ''
        : CONTENT_ROOT_SELECTOR + '{--dsh-chat-user-width:' + widthExpr(content.px, CONTENT_EDGE_PX) + '}';
      const composerRule = composer.follow
        ? ''
        : BODY_SELECTOR + '{--dsh-composer-card-max-width:' + widthExpr(composer.px, COMPOSER_EDGE_PX) + '}';
      style.textContent = [
        contentRule,
        composerRule,
        '.dshCw_row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}',
        '.dshCw_text{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}',
        '.dshCw_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
        '.dshCw_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
        '.dshCw_control{align-items:center;gap:10px;flex:none;display:flex}',
        '.dshCw_slider{width:180px;accent-color:var(--dsw-alias-brand-primary, #247bbf);cursor:pointer;margin:0}',
        '.dshCw_value{color:var(--dsw-alias-label-secondary);min-width:78px;text-align:right;font-size:13px;line-height:20px;font-variant-numeric:tabular-nums}',
        '.dshCw_reset{color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:var(--dsw-radius-md);padding:6px 10px;cursor:pointer;font:inherit;font-size:13px;line-height:20px}',
        '.dshCw_reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      ].join('\n');
    }

    /**
     * Persist one width and re-apply.
     * @param {string} key - CONTENT_KEY or COMPOSER_KEY.
     * @param {number|null} value - width in px, or null to clear (back to stock / follow).
     */
    function save(key, value) {
      try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, String(Math.round(value)));
      } catch {}
      applyStyles();
    }

    /**
     * One General Settings row: title, description, slider, width label, reset.
     * @param {object} props - composed slot props ({ t }) plus the row configuration.
     * @returns {object} the row element.
     */
    function WidthRow({ t, ...row }) {
      const [state, setState] = React.useState(row.read);
      const max = Math.max(PX_MIN, row.maxPx());
      const active = !row.isDefault(state);
      const shown = row.shown(state, t);
      const onChange = (event) => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value)) return;
        const px = clampPx(value, row.edge);
        setState(row.mode === 'stock' ? { stock: false, px } : { follow: false, px });
        save(row.rowKey, px);
      };
      const onReset = () => {
        save(row.rowKey, null);
        setState(row.read());
      };
      return h('div', { className: 'dshCw_row' },
        h('div', { className: 'dshCw_text' },
          h('div', { className: 'dshCw_title' }, t(row.titleKey)),
          h('div', { className: 'dshCw_desc' }, t(row.descKey)),
        ),
        h('div', { className: 'dshCw_control' },
          h('input', {
            className: 'dshCw_slider',
            type: 'range',
            min: PX_MIN,
            max,
            step: 8,
            value: Math.min(max, Math.max(PX_MIN, shown.px)),
            'aria-label': t(row.titleKey),
            onChange,
          }),
          h('span', { className: 'dshCw_value' }, active ? shown.px + 'px' : shown.label),
          active ? h('button', {
            type: 'button',
            className: 'dshCw_reset',
            onClick: onReset,
          }, t('reset')) : null,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: {
            contentTitle: '对话内容宽度',
            contentDesc: '调整回答内容列宽度（像素）。默认状态与未安装本插件时完全一致，宽度不超过当前对话列。',
            composerTitle: '输入框宽度',
            composerDesc: '单独调整底部输入卡片及其上方队列的宽度；默认跟随对话内容宽度（内容宽 + 32px）。',
            reset: '恢复默认',
            stock: '默认',
            follow: '跟随内容',
          },
          en: {
            contentTitle: 'Chat column width',
            contentDesc: 'Adjust the answer column width in pixels. The default state is identical to a page without this plugin, and never exceeds the current conversation column.',
            composerTitle: 'Composer width',
            composerDesc: 'Adjust the input card and the queue above it separately; by default it follows the chat column (column + 32px).',
            reset: 'Reset',
            stock: 'Default',
            follow: 'Follow chat',
          },
        }), 'chat-width: dictionaries');
        dropLegacyKeys();
        applyStyles();
        watchColumn();
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'chat-width',
          order: 25,
          locale: NS,
        }, (props) => h(WidthRow, {
          ...props,
          titleKey: 'contentTitle',
          descKey: 'contentDesc',
          rowKey: CONTENT_KEY,
          mode: 'stock',
          edge: CONTENT_EDGE_PX,
          read: readContent,
          maxPx: () => Math.round(rangeColumn() - CONTENT_EDGE_PX),
          isDefault: (state) => state.stock,
          shown: (state, t) => ({
            px: state.stock ? stockContentPx() || PX_MIN : state.px,
            label: t('stock'),
          }),
        })));
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'chat-width-composer',
          order: 26,
          locale: NS,
        }, (props) => h(WidthRow, {
          ...props,
          titleKey: 'composerTitle',
          descKey: 'composerDesc',
          rowKey: COMPOSER_KEY,
          mode: 'follow',
          edge: COMPOSER_EDGE_PX,
          read: readComposer,
          maxPx: () => Math.round(rangeColumn() - COMPOSER_EDGE_PX),
          isDefault: (state) => state.follow,
          shown: (state, t) => ({
            px: state.follow ? readComposer().px : state.px,
            label: t('follow'),
          }),
        })));
      },
    };
  },
});
