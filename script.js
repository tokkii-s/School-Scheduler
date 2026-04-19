/**
 * School Scheduler - Main Application Logic
 */

// ========== 初期データ設計 ==========
const DEFAULT_TIMETABLE_STATE = [
  { day: 1, name: '月', periods: ['', '', '', '', '', '', ''], dismissal: '15:30' },
  { day: 2, name: '火', periods: ['', '', '', '', '', '', ''], dismissal: '15:30' },
  { day: 3, name: '水', periods: ['', '', '', '', '', '', ''], dismissal: '15:30' },
  { day: 4, name: '木', periods: ['', '', '', '', '', '', ''], dismissal: '15:30' },
  { day: 5, name: '金', periods: ['', '', '', '', '', '', ''], dismissal: '15:30' }
];

// ========== State Management ==========
let state = {
  defaultTimetable: [],
  submissions: [], // { id, content, deadline, notes }
  customDays: {}, // 'YYYY-MM-DD': { isRemoved: true, timetable: [], dismissal: '' }
  notes: {}, // 'YYYY-MM-DD': ['note1', 'note2']
  subjects: [], // { id, name }
  records: {} // subjectId: [{ id, date, content }]
};

// ユーティリティ: 日付を YYYY-MM-DD 形式の文字列にする
const formatDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// ユーティリティ: YYYY-MM-DDから表示用文字列を生成
const getFormattedDateText = (dateStr) => {
  const date = new Date(dateStr);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${m}月${d}日`;
};

// ユーティリティ: 曜日取得
const getDayOfWeek = (date) => {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return days[date.getDay()];
};
const getDayClass = (date) => {
  const classes = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return classes[date.getDay()];
};

// ========== データ永続化 (LocalStorage) ==========
const loadState = () => {
  const load = (key, defaultVal) => {
    const saved = localStorage.getItem(`ss_${key}`);
    return saved ? JSON.parse(saved) : defaultVal;
  };
  state.defaultTimetable = load('defaultTimetable', DEFAULT_TIMETABLE_STATE);
  state.submissions = load('submissions', []);
  state.customDays = load('customDays', {});
  state.notes = load('notes', {});
  state.subjects = load('subjects', []);
  state.records = load('records', {});
  
  // 期限切れ提出物の自動削除
  cleanupOverdueSubmissions();
};

const saveState = () => {
  const save = (key, val) => localStorage.setItem(`ss_${key}`, JSON.stringify(val));
  save('defaultTimetable', state.defaultTimetable);
  save('submissions', state.submissions);
  save('customDays', state.customDays);
  save('notes', state.notes);
  save('subjects', state.subjects);
  save('records', state.records);
};

// 期限切れ提出物の削除処理
const cleanupOverdueSubmissions = () => {
  const today = formatDateString(new Date());
  const initialLength = state.submissions.length;
  state.submissions = state.submissions.filter(sub => sub.deadline >= today);
  if (state.submissions.length !== initialLength) {
    saveState();
  }
};

// ========== UI/UX ユーティリティ ==========
const showToast = (message, type = 'info') => {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';
  
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

const confirmDialog = (message, onConfirm) => {
  const dialog = document.getElementById('confirm-dialog');
  const msgEl = document.getElementById('confirm-message');
  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  
  msgEl.textContent = message;
  dialog.style.display = 'flex';
  
  const closeDialog = () => {
    dialog.style.display = 'none';
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', closeDialog);
  };
  
  const handleOk = () => {
    onConfirm();
    closeDialog();
  };
  
  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', closeDialog);
};

// ========== タブナビゲーション ==========
const initTabs = () => {
  const navBtns = document.querySelectorAll('.nav-btn');
  const panels = document.querySelectorAll('.tab-panel');
  
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = btn.getAttribute('data-tab');
      
      // Update buttons
      navBtns.forEach(b => b.classList.remove('active'));
      const activeBtn = e.target.closest('.nav-btn');
      activeBtn.classList.add('active');
      
      // Special animation on add button
      if (activeBtn.classList.contains('nav-btn-add')) {
        activeBtn.style.transform = 'scale(0.9)';
        setTimeout(() => activeBtn.style.transform = '', 100);
      }
      
      // Update panels
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${tabId}`).classList.add('active');
      
      // Trigger tab-specific refresh
      refreshTab(tabId);
    });
  });
};

const refreshTab = (tabId) => {
  switch(tabId) {
    case 'home':
      resetFeed();
      loadMoreDays();
      document.getElementById('today-date').textContent = `${getFormattedDateText(formatDateString(new Date()))} のスケジュール`;
      break;
    case 'submissions':
      renderSubmissions();
      break;
    case 'timetable':
      renderDefaultTimetableEditor();
      break;
    case 'records':
      renderSubjectsList();
      document.getElementById('records-subjects-view').style.display = 'block';
      document.getElementById('records-detail-view').style.display = 'none';
      break;
  }
};

// ========== ホームタブ機能 (無限スクロール) ==========
let currentFeedDateStr = formatDateString(new Date());
let loadedDaysCount = 0;
const DAYS_PER_LOAD = 5;
let isFeedLoading = false;

const isSchoolDay = (dateStr) => {
  const custom = state.customDays[dateStr];
  if (custom && custom.isRemoved) return false;
  if (custom && custom.timetable) return true; // 追加された登校日
  
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();
  // デフォルトで月曜(1)から金曜(5)が登校日
  return dayOfWeek >= 1 && dayOfWeek <= 5;
};

const getDaySchedule = (dateStr) => {
  const custom = state.customDays[dateStr];
  let timetable = [];
  let dismissal = '';
  
  const date = new Date(dateStr);
  const dayOfWeek = date.getDay();

  if (custom && custom.timetable) {
    // カスタム設定(追加または変更)
    timetable = custom.timetable;
    dismissal = custom.dismissal;
  } else if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    // デフォルト時間割
    const defaultDay = state.defaultTimetable.find(d => d.day === dayOfWeek);
    if (defaultDay) {
      timetable = defaultDay.periods;
      dismissal = defaultDay.dismissal;
    }
  }
  
  return { timetable, dismissal };
};

const createDayCard = (dateStr) => {
  const date = new Date(dateStr);
  const today = formatDateString(new Date());
  const isToday = dateStr === today;
  
  const { timetable, dismissal } = getDaySchedule(dateStr);
  
  // 今日の提出物取得（指定日が期限のものを表示）
  const daySubmissions = state.submissions.filter(s => s.deadline === dateStr);
  const dayNotes = state.notes[dateStr] || [];
  
  const card = document.createElement('div');
  card.className = `card day-card ${isToday ? 'today' : ''}`;
  
  // Header
  const headerHtml = `
    <div class="day-card-header">
      <div>
        <span class="day-date">${getFormattedDateText(dateStr)}</span>
        <span class="day-weekday ${getDayClass(date)}">${getDayOfWeek(date)}</span>
        ${isToday ? '<span class="today-badge">Today</span>' : ''}
      </div>
      ${dismissal ? `<div class="day-dismissal">下校: ${dismissal}</div>` : ''}
    </div>
  `;
  
  // Timetable
  const validPeriods = timetable.map((s, i) => ({ subj: s, idx: i + 1 })).filter(p => p.subj.trim() !== '');
  let timetableHtml = '';
  if (validPeriods.length > 0) {
    const periodHtml = validPeriods.map(p => `<span class="day-period"><span class="period-num">${p.idx}</span>${p.subj}</span>`).join('');
    timetableHtml = `
      <div class="day-section">
        <div class="day-section-title">時間割</div>
        <div class="day-timetable">
          ${periodHtml}
        </div>
      </div>
    `;
  }
  
  // Submissions
  let submissionsHtml = '';
  if (daySubmissions.length > 0) {
    const itemHtml = daySubmissions.map(s => `
      <div class="day-submission-item ${s.deadline === today ? 'urgent' : ''}">
        ${s.content}
      </div>
    `).join('');
    submissionsHtml = `
      <div class="day-section">
        <div class="day-section-title">提出物 (期限日)</div>
        ${itemHtml}
      </div>
    `;
  }
  
  // Notes
  let notesHtml = '';
  if (dayNotes.length > 0) {
    const noteText = dayNotes.join('\n');
    notesHtml = `
      <div class="day-section">
        <div class="day-section-title">備考</div>
        <div class="day-notes">${noteText}</div>
      </div>
    `;
  }
  
  // なにもない日
  let emptyHtml = '';
  if (validPeriods.length === 0 && daySubmissions.length === 0 && dayNotes.length === 0) {
    emptyHtml = `<div class="day-section"><div style="font-size:0.85rem;color:var(--text-muted);">予定は登録されていません</div></div>`;
  }
  
  card.innerHTML = headerHtml + timetableHtml + submissionsHtml + notesHtml + emptyHtml;
  return card;
};

const getNextDateStr = (dateStr) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return formatDateString(d);
};

const getNextNschoolDays = (startDateStr, n) => {
  let days = [];
  let curr = startDateStr;
  let safetyLoop = 0;
  
  while (days.length < n && safetyLoop < 100) {
    if (isSchoolDay(curr)) {
      days.push(curr);
    }
    curr = getNextDateStr(curr);
    safetyLoop++;
  }
  return { days, nextDate: curr };
};

const loadMoreDays = () => {
  if (isFeedLoading) return;
  isFeedLoading = true;
  
  const feed = document.getElementById('home-feed');
  const sentinel = document.getElementById('scroll-sentinel');
  sentinel.classList.remove('hidden');
  
  // 少し遅延を入れてUIがスムーズに感じられるようにする
  setTimeout(() => {
    const { days, nextDate } = getNextNschoolDays(currentFeedDateStr, DAYS_PER_LOAD);
    
    days.forEach(dateStr => {
      feed.appendChild(createDayCard(dateStr));
    });
    
    currentFeedDateStr = nextDate;
    loadedDaysCount += days.length;
    isFeedLoading = false;
    sentinel.classList.add('hidden');
    
    // もし読み込み後もセンチネルが画面内にあれば、画面が埋まるまで継続して読み込む
    if (document.getElementById('tab-home').classList.contains('active')) {
      if (sentinel.getBoundingClientRect().top < window.innerHeight + 300) {
        loadMoreDays();
      }
    }
  }, 400);
};

const resetFeed = () => {
  document.getElementById('home-feed').innerHTML = '';
  currentFeedDateStr = formatDateString(new Date());
  loadedDaysCount = 0;
};

// Intersection Observer for Infinite Scroll
const initInfiniteScroll = () => {
  const sentinel = document.getElementById('scroll-sentinel');
  const observer = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && !isFeedLoading && document.getElementById('tab-home').classList.contains('active')) {
      loadMoreDays();
    }
  }, { rootMargin: '0px 0px 300px 0px' });
  
  observer.observe(sentinel);
  
  // フォールバック用の旧来のスクロールイベント（確実な発火のため）
  window.addEventListener('scroll', () => {
    if (document.getElementById('tab-home').classList.contains('active') && !isFeedLoading) {
      if (sentinel.getBoundingClientRect().top < window.innerHeight + 300) {
        loadMoreDays();
      }
    }
  }, { passive: true });
};


// ========== 提出物タブ 機能 ==========
const calculateDaysRemaining = (deadlineStr) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDate = new Date(deadlineStr);
  deadlineDate.setHours(0, 0, 0, 0);
  const diffTime = deadlineDate - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const renderSubmissions = () => {
  const list = document.getElementById('submissions-list');
  const empty = document.getElementById('submissions-empty');
  
  // Sort by deadline
  const sorted = [...state.submissions].sort((a, b) => a.deadline.localeCompare(b.deadline));
  list.innerHTML = '';
  
  if (sorted.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    sorted.forEach((sub, idx) => {
      const daysRem = calculateDaysRemaining(sub.deadline);
      const isUrgent = daysRem <= 1;
      
      const card = document.createElement('div');
      card.className = 'card submission-card';
      card.style.animationDelay = `${idx * 0.1}s`;
      
      let remainingText = '';
      if (daysRem < 0) remainingText = '期限切れ';
      else if (daysRem === 0) remainingText = '今日まで';
      else if (daysRem === 1) remainingText = '明日まで';
      else remainingText = `あと${daysRem}日`;
      
      card.innerHTML = `
        <div class="submission-content">${sub.content}</div>
        <div class="submission-meta">
          <span class="meta-badge deadline ${isUrgent ? 'urgent' : ''}">
            🗓️ ${getFormattedDateText(sub.deadline)}
          </span>
          <span class="meta-badge remaining">
            ⏳ ${remainingText}
          </span>
        </div>
        ${sub.notes ? `<div class="submission-notes">${sub.notes}</div>` : ''}
        <button class="submission-delete" data-id="${sub.id}" title="削除">
          ×
        </button>
      `;
      list.appendChild(card);
    });
    
    // Add delete events
    list.querySelectorAll('.submission-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        confirmDialog('この提出物を削除しますか？', () => {
          state.submissions = state.submissions.filter(s => s.id !== id);
          saveState();
          showToast('提出物を削除しました', 'success');
          renderSubmissions();
        });
      });
    });
  }
};

// ========== 予定追加タブ 機能 ==========
const initAddForms = () => {
  // アコーディオン切り替え
  document.querySelectorAll('.section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.add-section');
      // 他のセクションを閉じる
      document.querySelectorAll('.add-section').forEach(sec => {
        if (sec !== parent) sec.classList.remove('expanded');
      });
      parent.classList.toggle('expanded');
    });
  });
  
  // 今日の日付をセット
  const todayStr = formatDateString(new Date());
  document.getElementById('sub-deadline').value = todayStr;
  document.getElementById('sd-date').value = todayStr;
  document.getElementById('rm-date').value = todayStr;
  document.getElementById('ct-date').value = todayStr;
  document.getElementById('note-date').value = todayStr;

  // 1. 提出物追加
  document.getElementById('form-add-submission').addEventListener('submit', (e) => {
    e.preventDefault();
    const content = document.getElementById('sub-content').value;
    const deadline = document.getElementById('sub-deadline').value;
    const notes = document.getElementById('sub-notes').value;
    
    state.submissions.push({
      id: Date.now().toString(),
      content, deadline, notes
    });
    saveState();
    showToast('提出物を追加しました', 'success');
    e.target.reset();
    document.getElementById('sub-deadline').value = todayStr;
  });
  
  const getPeriodsFromInputs = (containerId) => {
    const inputs = document.querySelectorAll(`#${containerId} input`);
    return Array.from(inputs).map(inp => inp.value);
  };
  
  // 2. 登校日追加
  document.getElementById('form-add-schoolday').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('sd-date').value;
    const dismissal = document.getElementById('sd-dismissal').value;
    const timetable = getPeriodsFromInputs('sd-timetable-inputs');
    
    state.customDays[date] = { isRemoved: false, timetable, dismissal };
    saveState();
    showToast('登校日を追加しました', 'success');
    e.target.reset();
    document.getElementById('sd-date').value = todayStr;
  });
  
  // 3. 登校日削除
  document.getElementById('form-remove-schoolday').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('rm-date').value;
    state.customDays[date] = { isRemoved: true };
    saveState();
    showToast('指定日を休みに設定しました', 'success');
  });
  
  // 4. 特定日の時間割変更
  document.getElementById('form-change-timetable').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('ct-date').value;
    const dismissal = document.getElementById('ct-dismissal').value;
    const timetable = getPeriodsFromInputs('ct-timetable-inputs');
    
    state.customDays[date] = { isRemoved: false, timetable, dismissal };
    saveState();
    showToast('時間割を変更しました', 'success');
    e.target.reset();
    document.getElementById('ct-date').value = todayStr;
  });
  
  // 5. 備考追加
  document.getElementById('form-add-note').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('note-date').value;
    const content = document.getElementById('note-content').value;
    
    if (!state.notes[date]) state.notes[date] = [];
    state.notes[date].push(content);
    
    saveState();
    showToast('備考を追加しました', 'success');
    e.target.reset();
    document.getElementById('note-date').value = todayStr;
  });
};

// ========== 時間割タブ 機能 ==========
const renderDefaultTimetableEditor = () => {
  const grid = document.getElementById('timetable-grid');
  const dismissGrid = document.getElementById('dismissal-row');
  
  grid.innerHTML = '<div class="timetable-cell"></div>'; // Empty corner
  ['月', '火', '水', '木', '金'].forEach(d => {
    grid.innerHTML += `<div class="timetable-cell header">${d}</div>`;
  });
  
  for (let p = 0; p < 7; p++) {
    grid.innerHTML += `<div class="timetable-cell period-label">${p + 1}限</div>`;
    for (let day = 1; day <= 5; day++) {
      const dayData = state.defaultTimetable.find(d => d.day === day);
      const subj = dayData ? dayData.periods[p] : '';
      grid.innerHTML += `
        <div class="timetable-cell">
          <input type="text" data-day="${day}" data-period="${p}" value="${subj}" placeholder="-">
        </div>
      `;
    }
  }
  
  dismissGrid.innerHTML = '<div class="dismissal-cell label">下校</div>';
  for (let day = 1; day <= 5; day++) {
    const dayData = state.defaultTimetable.find(d => d.day === day);
    const dTime = dayData ? dayData.dismissal : '';
    dismissGrid.innerHTML += `
      <div class="dismissal-cell">
        <input type="time" data-day="${day}" class="dismissal-input" value="${dTime}">
      </div>
    `;
  }
};

const initTimetableFeature = () => {
  document.getElementById('btn-save-timetable').addEventListener('click', () => {
    const inputs = document.querySelectorAll('#timetable-grid input');
    const dismissInputs = document.querySelectorAll('#dismissal-row input');
    
    // Reset state
    state.defaultTimetable.forEach(d => d.periods = ['', '', '', '', '', '', '']);
    
    inputs.forEach(inp => {
      const day = parseInt(inp.getAttribute('data-day'));
      const period = parseInt(inp.getAttribute('data-period'));
      const dayData = state.defaultTimetable.find(d => d.day === day);
      if (dayData) {
        dayData.periods[period] = inp.value;
      }
    });
    
    dismissInputs.forEach(inp => {
      const day = parseInt(inp.getAttribute('data-day'));
      const dayData = state.defaultTimetable.find(d => d.day === day);
      if (dayData) {
        dayData.dismissal = inp.value;
      }
    });
    
    saveState();
    showToast('時間割を保存しました', 'success');
  });
};

// ========== 授業記録タブ 機能 ==========
let currentSubjectId = null;

const renderSubjectsList = () => {
  const list = document.getElementById('subjects-list');
  const empty = document.getElementById('subjects-empty');
  
  list.innerHTML = '';
  if (state.subjects.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    state.subjects.forEach(subj => {
      const records = state.records[subj.id] || [];
      const card = document.createElement('div');
      card.className = 'card subject-card';
      card.innerHTML = `
        <div class="subject-info" data-id="${subj.id}">
          <div class="subject-icon">${subj.name.charAt(0)}</div>
          <div>
            <div class="subject-name">${subj.name}</div>
            <div class="subject-count">${records.length} 件の記録</div>
          </div>
        </div>
        <div class="subject-actions">
          <button class="subject-delete-btn" data-id="${subj.id}" title="科目削除">×</button>
          <span class="subject-arrow">›</span>
        </div>
      `;
      list.appendChild(card);
    });
    
    // イベント付与
    list.querySelectorAll('.subject-info').forEach(el => {
      el.addEventListener('click', () => openSubjectDetail(el.getAttribute('data-id')));
    });
    
    list.querySelectorAll('.subject-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.target.getAttribute('data-id');
        confirmDialog('この科目を削除しますか？\n(記録もすべて消えます)', () => {
          state.subjects = state.subjects.filter(s => s.id !== id);
          delete state.records[id];
          saveState();
          showToast('科目を削除しました', 'success');
          renderSubjectsList();
        });
      });
    });
  }
};

const openSubjectDetail = (subjId) => {
  currentSubjectId = subjId;
  const subj = state.subjects.find(s => s.id === subjId);
  if (!subj) return;
  
  document.getElementById('records-subjects-view').style.display = 'none';
  document.getElementById('records-detail-view').style.display = 'block';
  document.getElementById('detail-subject-name').textContent = subj.name;
  
  // 今日の日付セット
  document.getElementById('record-date').value = formatDateString(new Date());
  
  renderRecordsList();
};

const renderRecordsList = () => {
  const list = document.getElementById('records-list');
  list.innerHTML = '';
  
  const records = state.records[currentSubjectId] || [];
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date)); // 日付の降順
  
  if (sorted.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">まだ記録がありません</div>';
  } else {
    sorted.forEach((rec, idx) => {
      const card = document.createElement('div');
      card.className = 'card record-card';
      card.style.animationDelay = `${idx * 0.05}s`;
      card.innerHTML = `
        <div class="record-date">${rec.date}</div>
        <div class="record-text">${rec.content}</div>
        <button class="record-delete" data-id="${rec.id}">×</button>
      `;
      list.appendChild(card);
    });
    
    list.querySelectorAll('.record-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        confirmDialog('この記録を削除しますか？', () => {
          state.records[currentSubjectId] = state.records[currentSubjectId].filter(r => r.id !== id);
          saveState();
          renderRecordsList();
        });
      });
    });
  }
};

const initRecordsFeature = () => {
  // 科目追加
  document.getElementById('btn-add-subject').addEventListener('click', () => {
    const input = document.getElementById('new-subject-input');
    const name = input.value.trim();
    if (!name) return;
    
    state.subjects.push({ id: Date.now().toString(), name });
    saveState();
    input.value = '';
    showToast('科目を追加しました', 'success');
    renderSubjectsList();
  });
  
  // 戻るボタン
  document.getElementById('btn-back-subjects').addEventListener('click', () => {
    document.getElementById('records-subjects-view').style.display = 'block';
    document.getElementById('records-detail-view').style.display = 'none';
    currentSubjectId = null;
    renderSubjectsList();
  });
  
  // 記録追加フォーム
  document.getElementById('form-add-record').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('record-date').value;
    const content = document.getElementById('record-content').value;
    
    if (!state.records[currentSubjectId]) state.records[currentSubjectId] = [];
    
    state.records[currentSubjectId].push({
      id: Date.now().toString(),
      date,
      content
    });
    
    saveState();
    e.target.reset();
    document.getElementById('record-date').value = formatDateString(new Date());
    showToast('記録を追加しました', 'success');
    renderRecordsList();
  });
  
  // TXTエクスポート機能
  document.getElementById('btn-export-records').addEventListener('click', () => {
    if (!currentSubjectId) return;
    const subj = state.subjects.find(s => s.id === currentSubjectId);
    const records = state.records[currentSubjectId] || [];
    
    if (records.length === 0) {
      showToast('出力する記録がありません', 'warning');
      return;
    }
    
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date)); // 昇順
    
    let text = `【授業記録】 ${subj.name}\n`;
    text += `出力日: ${formatDateString(new Date())}\n`;
    text += `===================================\n\n`;
    
    sorted.forEach(r => {
      text += `[${r.date}]\n${r.content}\n\n-------------------------\n\n`;
    });
    
    // Blob を生成してダウンロード
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `授業記録_${subj.name}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('ファイルをダウンロードしました', 'success');
  });
};

// ========== データ管理機能 (JSON Export/Import) ==========
const initDataManagement = () => {
  const overlay = document.getElementById('data-mgmt-overlay');
  
  // モーダル開閉
  document.getElementById('btn-open-data-mgmt').addEventListener('click', () => {
    overlay.style.display = 'flex';
  });
  
  document.getElementById('btn-close-data-mgmt').addEventListener('click', () => {
    overlay.style.display = 'none';
  });
  
  // エクスポート処理
  document.getElementById('btn-export-json').addEventListener('click', () => {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `school_scheduler_backup_${formatDateString(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('JSONデータをエクスポートしました', 'success');
  });

  // インポート処理
  document.getElementById('import-json-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedState = JSON.parse(event.target.result);
        
        // 簡易的なデータ整合性チェック
        if (typeof importedState === 'object' && importedState !== null && 'defaultTimetable' in importedState) {
          confirmDialog('現在のすべての記録が上書きされます。よろしいですか？', () => {
            state = { ...state, ...importedState };
            saveState();
            showToast('データをインポートしました。画面を再読み込みします…', 'success');
            setTimeout(() => {
              location.reload();
            }, 1500);
          });
        } else {
          showToast('無効なJSONデータです。', 'error');
        }
      } catch (error) {
        showToast('ファイルの読み込みに失敗しました。', 'error');
      }
      e.target.value = ''; // 連続で同じファイルを読み込めるようにリセット
    };
    reader.readAsText(file);
  });
};


// ========== 初期化処理 ==========
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initTabs();
  initAddForms();
  initTimetableFeature();
  initRecordsFeature();
  initDataManagement();
  
  // 初回ロード用
  refreshTab('home');
  initInfiniteScroll();
});

// PWAサポート対応(将来的な拡張用)
if ('serviceWorker' in navigator) {
  // navigator.serviceWorker.register('/sw.js');
}
