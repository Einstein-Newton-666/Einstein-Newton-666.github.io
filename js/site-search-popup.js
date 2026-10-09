/* 快搜弹层（导航栏右上角那个放大镜）的增强：观感 + 键盘操作。
 *
 * 站点只保留这一个搜索界面：弹层本身就是完整搜索（放大后的结果区），不再有独立的搜索页。
 * 所以原本由搜索页提供的两件事搬到了这里：
 *   · ↑ / ↓ 选择结果、回车打开（主题弹层本来只有鼠标）；
 *   · 每条结果最多给 3 段命中摘要（主题默认 1 段，配置在 _config.redefine.yml 的
 *     navbar.search.top_n_per_article）。
 *
 * 另外三件观感 / 易用性的事：
 *   · 输入框左侧的键盘图标（点它是清空，含义全靠猜）换成放大镜，清空另给一个「清空」按钮；
 *   · 结果条目从虚线下划线 + 小圆点改成玻璃条目 + 文章图标；
 *   · 点结果跳转前把 body 的滚动锁还回去（见 releaseScrollLock）。
 *
 * 边界：只往主题的 DOM 里追加节点 / 挂监听，主题自己的输入、取索引、渲染、关闭逻辑一行不动。
 *
 * 为什么放全局（inject.footer）：弹层出现在每个页面。
 * 为什么还要挂 page:view：弹层长在 #swup 容器里，Swup 换页会用新页面的弹层替换掉它
 * （连同这里插入的节点），而 inject.footer 的脚本切页不会重跑（主题的 SwupScriptsPlugin
 * 只重放容器内带 data-swup-reload-script 的脚本），不重新接线的话换一次页就全没了。
 */
(function () {
  'use strict';

  const FIELD_ICON_CLASS = 'site-search-field-icon';
  const RESULT_ICON_CLASS = 'site-search-result-icon';
  const CLEAR_CLASS = 'site-search-popup-clear';
  const COUNT_CLASS = 'site-search-popup-count';
  const SELECTED_CLASS = 'is-selected';

  function makeIcon(classes) {
    const icon = document.createElement('i');
    icon.className = classes;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function rowsOf(resultBox) {
    return Array.prototype.slice.call(resultBox.querySelectorAll('.search-result-list li'));
  }

  /** 输入框左侧的放大镜（纯装饰；主题那个「键盘 = 清空」的图标由 CSS 隐掉） */
  function mountFieldIcon(popup) {
    const container = popup.querySelector('.search-input-container');
    if (!container || container.querySelector(`.${FIELD_ICON_CLASS}`)) return;
    container.insertBefore(
      makeIcon(`fa-solid fa-magnifying-glass ${FIELD_ICON_CLASS}`),
      container.firstChild,
    );
  }

  /** 「清空」按钮：主题原本靠键盘图标承担这件事，图标换掉之后得给个看得懂的 */
  function mountClearButton(popup, field) {
    let button = popup.querySelector(`.${CLEAR_CLASS}`);
    if (!button) {
      const closeButton = popup.querySelector('.popup-btn-close');
      if (!closeButton || !closeButton.parentNode) return;
      button = document.createElement('button');
      button.type = 'button';
      button.className = CLEAR_CLASS;
      button.textContent = '清空';
      button.addEventListener('click', () => {
        field.value = '';
        // 派发 input 让主题自己重渲染结果（它的匹配逻辑挂在 document 的 input 事件上）
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.focus();
      });
      closeButton.parentNode.insertBefore(button, closeButton);
    }
    button.hidden = field.value.trim() === '';
  }

  /**
   * 点结果跳转前把 body 的滚动锁还回去。
   * 弹层打开时主题把 body 锁成 overflow:hidden，只在「关闭弹层」时解锁；而点结果是直接跳转
   * （Swup 换页不重载文档），锁会一直留着 —— 到了新页面滚不动。主题弹层在各站都这样，这里兜住。
   */
  function releaseScrollLock(popup) {
    if (popup.dataset.siteSearchScroll === 'bound') return;
    popup.dataset.siteSearchScroll = 'bound';
    popup.addEventListener('click', (event) => {
      const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (link) document.body.style.overflow = '';
    });
  }

  function paintSelection(resultBox, state) {
    rowsOf(resultBox).forEach((row, index) => {
      row.classList.toggle(SELECTED_CLASS, index === state.index);
    });
  }

  /** 结果条目左侧的文章图标；同时把键盘选中项收敛到有效范围、重算「放不下」的提示 */
  function decorateResults(popup, resultBox, state) {
    rowsOf(resultBox).forEach((row) => {
      const title = row.querySelector('.search-result-title');
      if (!title || title.querySelector(`.${RESULT_ICON_CLASS}`)) return;
      title.insertBefore(makeIcon(`fa-solid fa-file-lines ${RESULT_ICON_CLASS}`), title.firstChild);
    });
    if (state.index >= rowsOf(resultBox).length) state.index = -1;
    paintSelection(resultBox, state);
    updateOverflow(popup, resultBox);
  }

  /** 头部的「共 N 条结果」 */
  function mountCount(popup) {
    let caption = popup.querySelector(`.${COUNT_CLASS}`);
    if (caption) return caption;
    const header = popup.querySelector('.search-header');
    if (!header) return null;
    caption = document.createElement('span');
    caption.className = COUNT_CLASS;
    caption.hidden = true;
    const clear = popup.querySelector(`.${CLEAR_CLASS}`);
    if (clear && clear.parentNode) clear.parentNode.insertBefore(caption, clear);
    else header.appendChild(caption);
    return caption;
  }

  /**
   * 结果放不下时的两个提示（样式在 anime-theme.css）：
   *   · 头部「共 N 条结果」—— 先说清一共多少条；
   *   · 弹层的 data-more —— 结果区还能往下滚时显示底部渐隐，滚到底自动收起。
   * 弹层高度封顶 74vh，结果再多也在结果区里滚，不会把弹层撑出屏幕。
   */
  function updateOverflow(popup, resultBox) {
    const caption = popup.querySelector(`.${COUNT_CLASS}`);
    const rows = rowsOf(resultBox).length;
    if (caption) {
      caption.hidden = rows === 0;
      caption.textContent = rows ? `共 ${rows} 条结果` : '';
    }
    const remaining = resultBox.scrollHeight - resultBox.clientHeight - resultBox.scrollTop;
    popup.dataset.more = remaining > 4 ? 'true' : 'false';
  }

  function select(resultBox, state, index) {
    const rows = rowsOf(resultBox);
    if (!rows.length) {
      state.index = -1;
      return;
    }
    state.index = Math.max(0, Math.min(rows.length - 1, index));
    paintSelection(resultBox, state);
    if (rows[state.index].scrollIntoView) rows[state.index].scrollIntoView({ block: 'nearest' });
  }

  /** ↑ / ↓ 选择、回车打开 —— 主题弹层只有鼠标，这里补上键盘（原本是搜索页的能力） */
  function mountKeyboardNav(field, resultBox, state) {
    field.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const rows = rowsOf(resultBox);
        if (!rows.length) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const from = state.index < 0 ? (step > 0 ? -1 : rows.length) : state.index;
        select(resultBox, state, from + step);
        return;
      }
      if (event.key === 'Enter') {
        const rows = rowsOf(resultBox);
        if (!rows.length) return;
        const row = rows[state.index >= 0 ? state.index : 0];
        const link = row.querySelector('a[href]');
        event.preventDefault();
        if (link) {
          document.body.style.overflow = ''; // 跳转前解锁，否则新页面滚不动
          link.click();
        }
      }
    });
  }

  function mount(popup, field, resultBox, state) {
    mountFieldIcon(popup);
    // 先建「清空」，再建条数：条数是插在「清空」前面的，清空还不存在时会退化成 appendChild，
    // 结果跑到 ✕ 右边去（截图里就是这样发现的）
    mountClearButton(popup, field);
    mountCount(popup);
    releaseScrollLock(popup);
    decorateResults(popup, resultBox, state);

    if (resultBox.dataset.siteSearchIcons === 'watched') return;
    resultBox.dataset.siteSearchIcons = 'watched';
    // 结果区自己滚：滚动或窗口变化后都要重算「下面还有没有」的提示
    resultBox.addEventListener('scroll', () => updateOverflow(popup, resultBox), { passive: true });
    window.addEventListener('resize', () => updateOverflow(popup, resultBox), { passive: true });
    if (typeof MutationObserver === 'function') {
      // 主题每次输入都会重写 #search-result 的 innerHTML：图标要补、选中项要回到有效范围、
      // 「共 N 条结果」与底部渐隐也要跟着重算
      new MutationObserver(() => decorateResults(popup, resultBox, state)).observe(resultBox, { childList: true, subtree: true });
    }
  }

  function attachToSwup(state) {
    const swup = window.swup;
    if (swup && swup.hooks && typeof swup.hooks.on === 'function') {
      swup.hooks.on('page:view', () => start(state));
      return true;
    }
    return false;
  }

  function start(state) {
    const popup = document.querySelector('.search-popup');
    const field = document.querySelector('.search-input');
    const resultBox = popup ? popup.querySelector('#search-result') : null;
    if (!popup || !field || !resultBox) return;

    mount(popup, field, resultBox, state);

    if (popup.dataset.siteSearchBound !== 'bound') {
      popup.dataset.siteSearchBound = 'bound';
      mountKeyboardNav(field, resultBox, state);
      field.addEventListener('input', () => {
        const button = popup.querySelector(`.${CLEAR_CLASS}`);
        if (button) button.hidden = field.value.trim() === '';
        // 换关键词就取消选中，免得回车打开的还是上一次选中的那条
        state.index = -1;
        paintSelection(resultBox, state);
        // 主题是异步重渲染结果的，这里先按当前 DOM 收一版（清空输入那一瞬间就没有结果了）
        updateOverflow(popup, resultBox);
      });
    }
  }

  const state = { index: -1 };

  // 直接跑，不等 DOMContentLoaded：这份脚本在 </body> 之前，而弹层标记在它前面，
  // 此刻已经可以接线。等 DOMContentLoaded 反而会让弹层里的东西晚一步出现。
  start(state);
  if (!document.querySelector('.search-popup')) {
    // 极端情况：脚本被提前/异步加载时弹层标记还没解析出来，等 DOM 好了补一次
    document.addEventListener('DOMContentLoaded', () => start(state), { once: true });
  }
  if (!attachToSwup(state)) {
    // 脚本顺序万一变了（Swup 还没建好）：等主题广播 ready 再挂上，别漏掉切页
    window.addEventListener('redefine:swup:ready', () => {
      start(state);
      attachToSwup(state);
    }, { once: true });
  }
}());
