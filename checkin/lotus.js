// 蓮花等級（福慧存摺與打卡頁共用）—— 要改門檻或文字，改這裡就好
(function () {
  const STEM = '#5f7f5a', LEAF = '#7d9b6e', SEED = '#a07a4a', SOIL = '#e9dcc3';
  const PINK = '#f2c7c0', PINK_DEEP = '#e3a39b', HEART = '#e6b85c';
  const GOLD = '#e8c278', GOLD_DEEP = '#c99a45';

  function flower(p, d, glow) {
    return `<svg viewBox="0 0 64 64">
      ${glow ? `<circle cx="32" cy="32" r="28" fill="#fbecc6" opacity="0.7"/>` : `<ellipse cx="32" cy="54" rx="24" ry="5" fill="${SOIL}"/>`}
      <path d="M32 46 C18 46 6 40 4 32 C14 30 26 36 32 46Z" fill="${p}"/>
      <path d="M32 46 C46 46 58 40 60 32 C50 30 38 36 32 46Z" fill="${p}"/>
      <path d="M32 46 C20 42 12 30 14 18 C24 22 30 34 32 46Z" fill="${d}"/>
      <path d="M32 46 C44 42 52 30 50 18 C40 22 34 34 32 46Z" fill="${d}"/>
      <path d="M32 46 C24 36 24 20 32 8 C40 20 40 36 32 46Z" fill="${p}"/>
      <circle cx="32" cy="40" r="3.5" fill="${HEART}"/>
      ${glow ? `<path d="M10 14 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5Z M54 8 l1 2.5 2.5 1 -2.5 1 -1 2.5 -1 -2.5 -2.5 -1 2.5 -1Z" fill="${GOLD_DEEP}"/>` : ''}
    </svg>`;
  }

  const ICON = {
    seed: `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="48" rx="18" ry="5" fill="${SOIL}"/>
      <ellipse cx="32" cy="42" rx="9" ry="7" fill="${SEED}"/>
      <path d="M32 36 C32 30 34 26 38 24" stroke="${STEM}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M38 24 C44 22 46 26 42 29 C39 31 37 28 38 24Z" fill="${LEAF}"/></svg>`,
    sprout: `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="52" rx="22" ry="5" fill="${SOIL}"/>
      <path d="M32 52 C32 40 32 30 33 20" stroke="${STEM}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M33 30 C22 22 12 26 12 32 C20 36 28 34 33 30Z" fill="${LEAF}"/>
      <path d="M33 22 C40 12 52 14 52 20 C46 26 38 26 33 22Z" fill="${LEAF}"/></svg>`,
    bud: `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="55" rx="22" ry="5" fill="${SOIL}"/>
      <path d="M32 55 C32 44 32 36 32 28" stroke="${STEM}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M32 46 C22 40 10 44 10 50 C18 54 28 52 32 46Z" fill="${LEAF}"/>
      <path d="M32 30 C22 24 24 12 32 6 C40 12 42 24 32 30Z" fill="${PINK}"/>
      <path d="M32 30 C27 24 28 14 32 9 C36 14 37 24 32 30Z" fill="${PINK_DEEP}"/></svg>`,
    open: `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="55" rx="22" ry="5" fill="${SOIL}"/>
      <path d="M32 55 C32 48 32 44 32 40" stroke="${STEM}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M32 50 C22 44 10 48 10 54 C18 58 28 56 32 50Z" fill="${LEAF}"/>
      <path d="M32 40 C22 38 14 28 16 16 C26 20 31 30 32 40Z" fill="${PINK_DEEP}"/>
      <path d="M32 40 C42 38 50 28 48 16 C38 20 33 30 32 40Z" fill="${PINK_DEEP}"/>
      <path d="M32 40 C24 32 24 18 32 6 C40 18 40 32 32 40Z" fill="${PINK}"/></svg>`,
    bloom: flower(PINK, PINK_DEEP, false),
    gold: flower(GOLD, GOLD_DEEP, true),
  };

  window.LOTUS_LEVELS = [
    { at: 0,   name: '蓮花種子', desc: '發心如初，種下善因', icon: ICON.seed },
    { at: 10,  name: '蓮花苗',   desc: '善根萌芽，日日精進', icon: ICON.sprout },
    { at: 30,  name: '蓮花苞',   desc: '含苞待放，修行漸深', icon: ICON.bud },
    { at: 60,  name: '初開蓮花', desc: '蓮花初開，福慧雙修', icon: ICON.open },
    { at: 100, name: '蓮花盛開', desc: '蓮花盛開，精進不退', icon: ICON.bloom },
    { at: 200, name: '金蓮',     desc: '功德圓滿，金蓮常開', icon: ICON.gold },
  ];

  // 依點數回傳 { idx, cur, next }
  window.lotusLevel = function (points) {
    let idx = 0;
    window.LOTUS_LEVELS.forEach((l, i) => { if (points >= l.at) idx = i; });
    return { idx, cur: window.LOTUS_LEVELS[idx], next: window.LOTUS_LEVELS[idx + 1] };
  };
})();
