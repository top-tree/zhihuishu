// ==UserScript==
// @name         智慧树掌握度AI全自动答题
// @version      1.0.0
// @description  全自动完成智慧树掌握度练习, 支持自定义AI模型及免费代理。
// @author       top tree
// @match        *://ai-smart-course-student-pro.zhihuishu.com/*
// @match        *://studentexamcomh5.zhihuishu.com/studentReviewTestOrExam/*
// @connect      api.coren.xin
// @connect      *
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

const PureUtils = Object.freeze({
    normalizeFullWidthLetters(text) {
        return String(text || '').replace(/[Ａ-Ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 65248));
    },
    normalizeTextForMatch(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[，。、“”‘’【】（）()《》：:；;,.!?！？'"`]/g, '');
    },
    normalizeQuestionKey(text) {
        const withoutNumber = String(text || '')
            .replace(/^\s*(?:(?:第\s*)?[一二三四五六七八九十百千万\d]+(?:题|[、.．:：)\）]))\s*/, '');
        return PureUtils.normalizeTextForMatch(withoutNumber);
    },
    normalizeQaRecord(item, fallbackUpdatedAt = Date.now()) {
        const q = String(item?.q || '').replace(/\s+/g, ' ').trim();
        const a = String(item?.a || '').replace(/\s+/g, ' ').trim();
        if (!q || !a) return null;

        const sourceUpdatedAt = Number(item?.updatedAt || 0);
        const fallback = Number(fallbackUpdatedAt || Date.now());
        return {
            q,
            a,
            updatedAt: sourceUpdatedAt > 0 ? sourceUpdatedAt : fallback
        };
    },
    mergeQaRecords(existingRecords = [], newRecords = [], updatedAt = Date.now()) {
        const byQuestion = new Map();
        const putRecord = (item, preferIncoming) => {
            const normalized = PureUtils.normalizeQaRecord(item, preferIncoming ? updatedAt : item?.updatedAt);
            if (!normalized) return;
            const key = PureUtils.normalizeQuestionKey(normalized.q);
            if (!key) return;

            const current = byQuestion.get(key);
            if (!current || preferIncoming || (normalized.updatedAt || 0) >= (current.updatedAt || 0)) {
                byQuestion.set(key, normalized);
            }
        };

        (Array.isArray(existingRecords) ? existingRecords : []).forEach(item => putRecord(item, false));
        (Array.isArray(newRecords) ? newRecords : []).forEach(item => putRecord(item, true));

        return Array.from(byQuestion.values())
            .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    },
    scoreQaHint(item, currentQuestion) {
        const currentKey = PureUtils.normalizeQuestionKey(currentQuestion || '');
        const hintKey = PureUtils.normalizeQuestionKey(item?.q || '');
        if (!currentKey || !hintKey) return 0;
        if (currentKey === hintKey) return 100000;
        if (currentKey.includes(hintKey) || hintKey.includes(currentKey)) {
            return 80000 + Math.min(currentKey.length, hintKey.length);
        }

        const currentChars = new Set(currentKey.split(''));
        const hintChars = new Set(hintKey.split(''));
        let shared = 0;
        hintChars.forEach(ch => {
            if (currentChars.has(ch)) shared += 1;
        });

        const denominator = Math.max(currentChars.size, hintChars.size, 1);
        const overlap = shared / denominator;
        if (overlap < 0.15) return 0;
        return Math.round(overlap * 10000);
    },
    rankQaHints(records = [], currentQuestion, maxItems = 8) {
        const limit = Math.max(0, Number(maxItems || 0));
        if (limit === 0) return [];

        return (Array.isArray(records) ? records : [])
            .map((item, index) => {
                const normalized = PureUtils.normalizeQaRecord(item, item?.updatedAt);
                return {
                    item: normalized,
                    index,
                    score: normalized ? PureUtils.scoreQaHint(normalized, currentQuestion) : 0
                };
            })
            .filter(entry => entry.item && entry.score > 0)
            .sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0) || a.index - b.index)
            .slice(0, limit)
            .map(entry => entry.item);
    },
    previewText(text, maxLen = 60) {
        const s = String(text || '').replace(/\s+/g, ' ').trim();
        if (s.length <= maxLen) return s;
        return `${s.slice(0, maxLen)}...`;
    },
    parseChoiceAnswer(rawContent, options, type) {
        let text = PureUtils.normalizeFullWidthLetters(rawContent).trim();

        if (type.includes('判断')) {
            if (/对|正确|\btrue\b|\bT\b|√/i.test(text)) return 'A';
            if (/错|错误|\bfalse\b|\bF\b|×/i.test(text)) return 'B';
        }

        let letters = text.toUpperCase().replace(/[^A-Z]/g, '');

        if (!letters && options && options.length > 0) {
            const normalizedReply = PureUtils.normalizeTextForMatch(text);
            let matched = '';
            options.forEach((opt, index) => {
                const normOpt = PureUtils.normalizeTextForMatch(opt);
                if (normOpt && normalizedReply.includes(normOpt)) {
                    matched += String.fromCharCode(65 + index);
                }
            });
            letters = matched;
        }

        const maxLetters = options ? options.length : 4;
        const result = [];
        for (const ch of letters) {
            const idx = ch.charCodeAt(0) - 65;
            if (idx >= 0 && idx < maxLetters && !result.includes(ch)) {
                result.push(ch);
            }
        }

        if (result.length === 0) return null;
        if (type.includes('单选') || type.includes('判断')) return result[0];
        return result.join('');
    },
    parseFillAnswer(rawContent) {
        let text = String(rawContent || '').trim();
        text = text.replace(/^答案[:：]?\s*/i, '');
        text = text.replace(/^填空答案[:：]?\s*/i, '');
        text = text.replace(/\r?\n+/g, '||');
        return text || null;
    },
    normalizeFillAnswerByQuestion(question, rawAnswer) {
        const cleaned = PureUtils.parseFillAnswer(rawAnswer);
        if (!cleaned) return null;

        const expected = Math.max(1, (String(question || '').match(/_{2,}|___|（\s*\)|\(\s*\)/g) || []).length);
        const parts = cleaned.split('||').map(s => s.trim()).filter(Boolean);
        if (parts.length === 0) return null;

        if (parts.length === expected) return parts.join('||');
        if (parts.length > expected) return parts.slice(0, expected).join('||');

        while (parts.length < expected) {
            parts.push(parts[parts.length - 1] || '');
        }
        return parts.join('||');
    }
});

const CoreUtils = Object.freeze({
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    createResult(ok, code, data = null, message = '') {
        return { ok: !!ok, code: String(code || 'unknown'), data, message: String(message || '') };
    },
    async retryAsync(executor, options = {}) {
        const attempts = Math.max(1, Number(options.attempts || 1));
        const shouldRetry = typeof options.shouldRetry === 'function'
            ? options.shouldRetry
            : (result, attempt) => !result?.ok && attempt < attempts;
        const getDelayMs = typeof options.getDelayMs === 'function'
            ? options.getDelayMs
            : () => 0;

        let lastResult = CoreUtils.createResult(false, 'not_executed');
        for (let attempt = 1; attempt <= attempts; attempt++) {
            lastResult = await executor(attempt);
            if (!shouldRetry(lastResult, attempt)) {
                return lastResult;
            }
            const waitMs = Math.max(0, Number(getDelayMs(lastResult, attempt) || 0));
            if (waitMs > 0) {
                await CoreUtils.delay(waitMs);
            }
        }
        return lastResult;
    }
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PureUtils, CoreUtils };
}

const isBrowserRuntime = typeof window !== 'undefined' && typeof document !== 'undefined';

if (isBrowserRuntime) {
(function () {
    'use strict';

    // --- 1. UI 和样式 ---
    GM_addStyle(`
        #ai-panel { position: absolute; top: 45px; right: 0; width: 360px; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; display: none; }
        #ai-panel.show { display: block; }
        #panel-toggle { position: absolute; top: 0; right: 0; width: 40px; height: 40px; background-color: #0d6efd; color: white; border: none; border-radius: 50%; cursor: pointer !important; display: flex; justify-content: center; align-items: center; font-size: 20px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); z-index: 10000; }
        #panel-header { padding: 15px; background-color: #0d6efd; color: white; border-top-left-radius: 8px; border-top-right-radius: 8px; font-size: 18px; font-weight: 500; cursor: move; }
        #panel-content { padding: 20px; display: flex; flex-direction: column; gap: 15px; }
        #start-button { padding: 10px 15px; background-color: #198754; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; transition: background-color 0.3s; }
        #start-button:hover { background-color: #157347; }
        #status-log { margin-top: 15px; padding: 10px; background-color: #f8fafc; border-radius: 8px; height: 260px; overflow-y: auto; font-size: 12px; color: #334155; border: 1px solid #dbe3ef; box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.05); }
        #status-log .log-item { margin-bottom: 8px; border: 1px solid #e2e8f0; border-left: 3px solid #94a3b8; border-radius: 6px; background: #ffffff; padding: 6px 8px; line-height: 1.45; }
        #status-log .log-item:last-child { margin-bottom: 0; }
        #status-log .log-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 3px; font-size: 11px; }
        #status-log .seq { color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        #status-log .time { color: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        #status-log .cat { border-radius: 4px; padding: 0 6px; font-weight: 600; }
        #status-log .level { color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        #status-log .log-msg { white-space: pre-wrap; word-break: break-word; color: #334155; }
        #status-log .cat-system { background: #eef2f7; color: #334155; border-left-color: #94a3b8; }
        #status-log .cat-flow { background: #ecfdf5; color: #166534; border-left-color: #22c55e; }
        #status-log .cat-ai { background: #eff6ff; color: #1d4ed8; border-left-color: #3b82f6; }
        #status-log .cat-question { background: #fefce8; color: #854d0e; border-left-color: #eab308; }
        #status-log .cat-submit { background: #f5f3ff; color: #6d28d9; border-left-color: #8b5cf6; }
        #status-log .cat-error { background: #fef2f2; color: #b91c1c; border-left-color: #ef4444; }
        #status-log .lv-debug .level { color: #94a3b8; }
        #status-log .lv-success .level { color: #15803d; }
        #status-log .lv-warn .level { color: #b45309; }
        #status-log .lv-error .level { color: #b91c1c; }
        .setting-group { font-size: 13px; margin-bottom: 5px; }
        .setting-group label { display: block; margin-bottom: 4px; color: #333; }
        .setting-group input, .setting-group select { width: 100%; box-sizing: border-box; padding: 6px; border: 1px solid #ccc; border-radius: 4px; }
        .hidden { display: none !important; }
        #save-settings { padding: 6px; background-color: #0dcaf0; color: #000; border: none; border-radius: 4px; cursor: pointer; }
        #save-settings:hover { background-color: #31d2f2; }
    `);

    const panelHTML = `
        <div id="ai-drag-container" style="position: fixed; top: 100px; right: 20px; z-index: 9999;">
            <button id="panel-toggle">AI</button>
            <div id="ai-panel">
                <div id="panel-header">AI 自动答题设置 (拖拽这里)</div>
                <div id="panel-content">
                    <div class="setting-group">
                        <label>AI 接口选择:</label>
                        <select id="ai-provider">
                            <option value="free">免费模型</option>
                            <option value="custom">自定义</option>
                        </select>
                    </div>
                    <div id="custom-ai-settings" class="hidden">
                        <div class="setting-group">
                            <label>Base URL:</label>
                            <input type="text" id="ai-url" autocomplete="off" spellcheck="false">
                        </div>
                        <div class="setting-group">
                            <label>API Key:</label>
                            <input type="text" id="ai-key" autocomplete="new-password" spellcheck="false" style="-webkit-text-security: disc;">
                        </div>
                        <div class="setting-group">
                            <label>Model:</label>
                            <input type="text" id="ai-model" autocomplete="off" spellcheck="false">
                        </div>
                        <button id="save-settings">保存接口设置</button>
                    </div>
                    <button id="start-button">开始自动答题</button>
                    <div id="status-log">状态日志...</div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', panelHTML);

    // --- 2. DOM元素 & 变量初始化 ---
    const panel = document.getElementById('ai-panel');
    const toggleButton = document.getElementById('panel-toggle');
    const startButton = document.getElementById('start-button');
    const statusLog = document.getElementById('status-log');
    let logSeq = 0;
    const KEYS = Object.freeze({
        gm: Object.freeze({
            panelVisible: 'panel_visible_state',
            autoMode: 'autoMode_state',
            aiProvider: 'ai_provider',
            aiUrl: 'ai_url',
            aiKey: 'ai_key',
            aiModel: 'ai_model',
            panelPosLeft: 'panel_pos_left',
            panelPosTop: 'panel_pos_top',
            runtimeLogBuffer: 'runtime_log_buffer_v1',
            noImproveCache: 'no_improve_cache_v1',
            chapterQaMemory: 'chapter_qa_memory_v1',
            currentChapterKeyGlobal: 'current_chapter_key_global_v1'
        }),
        session: Object.freeze({
            currentChapterKey: 'current_chapter_key',
            lastAttemptedItem: 'last_attempted_item',
            courseListUrl: 'course_list_url',
            lastExamPreviewUrl: 'last_exam_preview_url'
        })
    });
    const storage = {
        getGm(key, fallback) {
            return GM_getValue(key, fallback);
        },
        setGm(key, value) {
            GM_setValue(key, value);
        },
        getSession(key, fallback = '') {
            const value = sessionStorage.getItem(key);
            return value === null ? fallback : value;
        },
        setSession(key, value) {
            sessionStorage.setItem(key, String(value));
        },
        removeSession(key) {
            sessionStorage.removeItem(key);
        }
    };

    const delay = CoreUtils.delay;
    const createResult = CoreUtils.createResult;
    const retryAsync = CoreUtils.retryAsync;

    function navigateTo(url, reason = '', category = 'NAV') {
        const target = String(url || '').trim();
        if (reason) {
            log(reason, 'info', category);
        }
        if (!target) {
            return createResult(false, 'invalid_url', null, 'empty navigation target');
        }
        window.location.href = target;
        return createResult(true, 'navigating', { target }, reason);
    }

    const SELECTORS = Object.freeze({
        common: Object.freeze({
            clickable: 'a, button, .el-button, .van-button, [role="button"], span, div',
            dialogWrappers: '.el-dialog__wrapper, .el-message-box__wrapper, .van-dialog'
        }),
        learnPage: Object.freeze({
            improveButtonCandidates: ['.simplified-mastery__action', '.improve-btn', 'button', '.el-button', '.van-button'],
            improveButtonDirect: '.improve-btn',
            activeItemName: '.title-text.active, .item-title.active, .section-item-collapse-info.active .title-text, .item-content.active .item-title',
            itemContent: '.item-content',
            itemTitle: '.item-title',
            progressText: '.el-progress__text span'
        }),
        testPage: Object.freeze({
            questionContent: '.questionContent',
            questionTitle: '.centent-pre pre.preStyle',
            questionType: '.letterSortNum',
            fillInputs: '.input-ques .fillAnswer input.el-input__inner, .input-ques .fillAnswer textarea.el-textarea__inner',
            optionNodes: '.el-radio, .el-checkbox, .option-item, .topic-option-item, ul.radio-view li',
            optionTextNode: '.preStyle, .option-content, .stem',
            optionClickableInput: '.el-radio__original, .el-checkbox__original, input[type="radio"], input[type="checkbox"]',
            optionCheckedInputs: '.el-radio__input.is-checked, .el-checkbox__input.is-checked, input[type="radio"]:checked, input[type="checkbox"]:checked',
            checkedFallback: '.el-radio__input.is-checked, .el-checkbox__input.is-checked, input[type="radio"]:checked, input[type="checkbox"]:checked, [aria-checked="true"], .option-item.active, .topic-option-item.active',
            anyCheckedGlobal: '.el-radio__input.is-checked, .el-checkbox__input.is-checked, input[type="radio"]:checked, input[type="checkbox"]:checked, [aria-checked="true"], .is-checked, .checked, .selected, .active',
            submitButton: '.reviewDone',
            nextButton: '.next-topic.next-t',
            answerCardFirstItem: '.answerCard .answer-item, .topic-list .topic-item, .card-list li, .answer-sheet li, .sheet-list li, .question-card li, .topic-card-item',
            answerCardEntryCandidates: 'button, a, span, div, .el-button, [role="button"]',
            answerCardFirstNumberCandidates: 'li, button, a, span, div',
            dialogCancelButton: '.cancel.button, .el-button--default, .van-dialog__cancel',
            dialogConfirmButton: '.comfirm.button, .el-button--primary, .van-dialog__confirm'
        }),
        pointPage: Object.freeze({
            examPreviewLinks: 'a[href*="/examPreview/"]'
        }),
        previewPage: Object.freeze({
            questionBlocks: '.questionContent, .question-item, .topic-item, .question-wrapper, .preview-question-item',
            questionTitle: '.quest-title .option-name .inner-box, .quest-title .option-name, .quest-title, .centent-pre pre.preStyle, .question-title, .topic-title, .stem, .title',
            referenceAnswerSpans: '.analysis .answer-title span, .answer-title span',
            answerTitle: '.analysis .answer-title, .answer-title',
            answerFallback: '.correct-answer, .right-answer, .analysis-answer, .answer-content, .answer, .answer-text',
            checkedFallback: '.is-checked, .checked, input:checked',
            errorResult: '.question-result.error'
        })
    });
    const LOG_BUFFER_MAX = 300;
    
    // 自定义AI设置相关的元素
    const providerSelect = document.getElementById('ai-provider');
    const customSettingsDiv = document.getElementById('custom-ai-settings');
    const apiUrlInput = document.getElementById('ai-url');
    const apiKeyInput = document.getElementById('ai-key');
    const apiModelInput = document.getElementById('ai-model');
    const saveSettingsBtn = document.getElementById('save-settings');

    let isPanelVisible = storage.getGm(KEYS.gm.panelVisible, true); // 默认开启
    let autoMode = storage.getGm(KEYS.gm.autoMode, false);

    // 初始化面板可见性
    if (isPanelVisible) {
        panel.classList.add('show');
        toggleButton.textContent = 'X';
    } else {
        panel.classList.remove('show');
        toggleButton.textContent = 'AI';
    }
    
    // 读取持久化的AI设置
    let savedProvider = storage.getGm(KEYS.gm.aiProvider, 'free');
    let savedApiUrl = storage.getGm(KEYS.gm.aiUrl, '');
    let savedApiKey = storage.getGm(KEYS.gm.aiKey, '');
    let savedApiModel = storage.getGm(KEYS.gm.aiModel, '');

    // 初始化UI状态
    providerSelect.value = savedProvider;
    apiUrlInput.value = savedApiUrl;
    apiKeyInput.value = savedApiKey;
    apiModelInput.value = savedApiModel;
    if (savedProvider === 'custom') {
        customSettingsDiv.classList.remove('hidden');
    }

    // 监听切换和保存事件
    providerSelect.addEventListener('change', (e) => {
        savedProvider = e.target.value;
        storage.setGm(KEYS.gm.aiProvider, savedProvider); // 切换时直接保存模式
        
        if (savedProvider === 'custom') {
            customSettingsDiv.classList.remove('hidden');
            log("已切换至 自定义模式。请确保下方配置正确并点击保存。");
        } else {
            customSettingsDiv.classList.add('hidden');
            log("已切换至 免费模型。直接点击开始答题即可。");
        }
    });

    saveSettingsBtn.addEventListener('click', () => {
        savedApiUrl = apiUrlInput.value.trim();
        savedApiKey = apiKeyInput.value.trim();
        savedApiModel = apiModelInput.value.trim();
        
        // 自动补全 /chat/completions
        if (savedApiUrl && !savedApiUrl.endsWith('/chat/completions')) {
            savedApiUrl = savedApiUrl.replace(/\/+$/, '') + '/chat/completions';
            apiUrlInput.value = savedApiUrl; // 更新UI显示
        }
        
        storage.setGm(KEYS.gm.aiUrl, savedApiUrl);
        storage.setGm(KEYS.gm.aiKey, savedApiKey);
        storage.setGm(KEYS.gm.aiModel, savedApiModel);
        
        log(`自定义接口设置已保存!`);
    });

    // --- 3. UI交互与拖拽逻辑 ---
    const dragContainer = document.getElementById('ai-drag-container');
    const panelHeader = document.getElementById('panel-header');
    
    // 拖拽逻辑
    let isDragging = false;
    let hasDragged = false;
    let startX, startY, initialLeft, initialTop;

    toggleButton.addEventListener('mousedown', (e) => {
        isDragging = true;
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = dragContainer.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        e.preventDefault(); // 防止选中文本
    });

    panelHeader.addEventListener('mousedown', (e) => {
        isDragging = true;
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = dragContainer.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        e.preventDefault(); 
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasDragged = true;
        }

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        // 限制在视口内
        // 允许一些溢出，防止因为计算问题卡死，但整体保持在屏幕内
        newLeft = Math.max(-dragContainer.offsetWidth + 50, Math.min(newLeft, window.innerWidth - 50));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - 50));

        dragContainer.style.left = `${newLeft}px`;
        dragContainer.style.top = `${newTop}px`;
        dragContainer.style.right = 'auto'; // 清除初始的 right 定位
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            storage.setGm(KEYS.gm.panelPosLeft, dragContainer.style.left);
            storage.setGm(KEYS.gm.panelPosTop, dragContainer.style.top);
        }
    });

    toggleButton.addEventListener('click', (e) => {
        if (hasDragged) {
            hasDragged = false;
            return;
        }
        isPanelVisible = !isPanelVisible;
        storage.setGm(KEYS.gm.panelVisible, isPanelVisible);
        panel.classList.toggle('show', isPanelVisible);
        toggleButton.textContent = isPanelVisible ? 'X' : 'AI';
    });

    startButton.addEventListener('click', () => toggleAutoMode(!autoMode));

    // --- 4. 核心功能函数 ---
    function getLogBuffer() {
        const value = storage.getGm(KEYS.gm.runtimeLogBuffer, []);
        if (Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(value || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function saveLogBuffer(buffer) {
        storage.setGm(KEYS.gm.runtimeLogBuffer, buffer.slice(-LOG_BUFFER_MAX));
    }

    function clearLogBuffer() {
        storage.setGm(KEYS.gm.runtimeLogBuffer, []);
        statusLog.innerHTML = '';
        logSeq = 0;
    }

    function normalizeCategory(category) {
        const c = String(category || '').toUpperCase();
        const alias = {
            'FLOW': 'FLOW',
            'NAV': 'FLOW',
            'QUESTION': 'QUESTION',
            'AI': 'AI',
            'MEMORY': 'SYSTEM',
            'SUBMIT': 'SUBMIT',
            'SYSTEM': 'SYSTEM',
            'SYS': 'SYSTEM',
            'ERROR': 'ERROR'
        };
        return alias[c] || 'SYSTEM';
    }

    function categoryLabel(category) {
        const c = normalizeCategory(category);
        const labels = {
            SYSTEM: '系统',
            FLOW: '流程',
            QUESTION: '题目',
            AI: '模型',
            SUBMIT: '提交',
            ERROR: '错误'
        };
        return labels[c] || c;
    }

    function shortenText(text, maxLen = 100) {
        const s = String(text || '').replace(/\s+/g, ' ').trim();
        if (s.length <= maxLen) return s;
        return `${s.slice(0, maxLen)}...`;
    }

    function normalizeLogMessage(message, category, level) {
        const cat = normalizeCategory(category);
        const lv = String(level || 'info').toLowerCase();
        const msg = String(message || '').replace(/\s+/g, ' ').trim();

        if (!msg) return '';

        if (cat === 'QUESTION') {
            if (msg.includes('处理题目')) return `题目处理中: ${shortenText(msg.replace(/^处理题目\s*\((.*?)\)\s*:\s*/,'[$1] '), 90)}`;
            if (msg.includes('当前题已作答')) return `跳过已作答题: ${shortenText(msg.replace('当前题已作答，跳过AI', ''), 90)}`;
            if (msg.includes('当前题未作答')) return `未作答，开始请求模型: ${shortenText(msg.replace(/^当前题未作答，准备调用AI[:：]?\s*/, ''), 90)}`;
            if (msg.includes('选择答案')) return `已选择答案: ${msg.replace(/^选择答案[:：]?\s*/, '').trim()}`;
        }

        if (cat === 'AI') {
            if (msg.includes('正在请求AI回答')) return msg.replace('正在请求AI回答', '请求模型');
            if (msg.includes('连续3次失败')) return `模型重试失败: ${msg}`;
        }

        if (lv === 'debug') {
            return shortenText(msg, 120);
        }

        return msg;
    }

    function renderLogEntry(entry) {
        const safeLevel = String(entry.level || 'info').toLowerCase();
        const safeTag = safeLevel.toUpperCase();
        const safeTime = entry.time || new Date().toLocaleTimeString();
        const safeCat = normalizeCategory(entry.category);
        const safeCatLabel = categoryLabel(safeCat);
        const safeMsg = String(entry.message || '');
        const seqText = String(entry.seq || '').padStart(4, '0');
        statusLog.innerHTML += `<div class="log-item cat-${safeCat.toLowerCase()} lv-${safeLevel}"><div class="log-head"><span class="seq">#${seqText}</span><span class="time">${safeTime}</span><span class="cat">${safeCatLabel}</span><span class="level">${safeTag}</span></div><div class="log-msg">${safeMsg}</div></div>`;
    }

    function renderLogBuffer() {
        statusLog.innerHTML = '';
        const buffer = getLogBuffer();
        logSeq = buffer.reduce((maxSeq, item) => Math.max(maxSeq, Number(item?.seq || 0)), 0);
        for (const entry of buffer) {
            renderLogEntry(entry);
        }
        statusLog.scrollTop = statusLog.scrollHeight;
    }

    function log(message, level = 'info', category = 'SYSTEM') {
        const lv = String(level || 'info').toLowerCase();
        const levelTag = lv.toUpperCase();
        const cat = normalizeCategory(category);
        const normalizedMessage = normalizeLogMessage(message, cat, lv);
        logSeq += 1;
        console.log(`[AI脚本][#${String(logSeq).padStart(4, '0')}][${levelTag}][${cat}] ${normalizedMessage}`);
        const timestamp = new Date().toLocaleTimeString();

        const entry = { seq: logSeq, time: timestamp, level: lv, category: cat, message: normalizedMessage };
        const buffer = getLogBuffer();
        buffer.push(entry);
        saveLogBuffer(buffer);

        if (statusLog.childElementCount >= LOG_BUFFER_MAX) {
            statusLog.removeChild(statusLog.firstElementChild);
        }

        renderLogEntry(entry);
        statusLog.scrollTop = statusLog.scrollHeight;
    }

    function isElementVisible(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function findImproveButton() {
        const selectors = SELECTORS.learnPage.improveButtonCandidates;
        for (const selector of selectors) {
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
                const text = ((node.textContent || node.innerText || '').replace(/\s+/g, ''));
                const disabled = !!node.disabled || node.getAttribute('aria-disabled') === 'true' || node.classList.contains('is-disabled');
                if (text.includes('去提升') && isElementVisible(node) && !disabled) {
                    return node;
                }
            }
        }
        return null;
    }

    function reliableClick(element) {
        if (!element) { log("警告: 尝试点击一个不存在的元素。"); return; }
        try {
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: unsafeWindow }));
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: unsafeWindow }));
        } catch (e) {}

        if (typeof element.click === 'function') {
            element.click();
        } else {
            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: unsafeWindow });
            element.dispatchEvent(clickEvent);
        }
    }

    function setInputValueReliably(inputElement, value) {
        if (!inputElement) return;
        const v = String(value ?? '');
        const proto = inputElement.tagName.toUpperCase() === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        inputElement.focus();
        inputElement.dispatchEvent(new Event('focus', { bubbles: true }));

        if (nativeSetter) nativeSetter.call(inputElement, v);
        else inputElement.value = v;

        inputElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
        inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
        inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
        inputElement.blur();
    }

    async function waitForElement(selector, timeout = 15000, interval = 500) {
        const endTime = Date.now() + timeout;
        while (Date.now() < endTime) {
            const el = document.querySelector(selector);
            if (el) return el;
            await delay(interval);
        }
        return null;
    }

    async function waitForUrlChange(startUrl, timeout = 8000, interval = 400) {
        const endTime = Date.now() + timeout;
        while (Date.now() < endTime) {
            if (window.location.href !== startUrl) {
                return true;
            }
            await delay(interval);
        }
        return false;
    }

    function getQuestionSnapshot() {
        const qContent = document.querySelector(SELECTORS.testPage.questionContent);
        if (!qContent) return { key: '', title: '', type: '' };
        const title = (qContent.querySelector(SELECTORS.testPage.questionTitle)?.innerText || '').replace(/\s+/g, ' ').trim();
        const type = (qContent.querySelector(SELECTORS.testPage.questionType)?.innerText || '').replace(/\s+/g, ' ').trim();
        const key = `${type}||${title}`;
        return { key, title, type };
    }

    async function waitForQuestionChange(prevKey, timeout = 4500, interval = 180) {
        const endTime = Date.now() + timeout;
        while (Date.now() < endTime) {
            const snap = getQuestionSnapshot();
            if (snap.key && snap.key !== prevKey) {
                return snap;
            }
            await delay(interval);
        }
        return null;
    }

    async function waitForQuestionStable(minStableMs = 320, timeout = 2500) {
        const endTime = Date.now() + timeout;
        let lastKey = '';
        let stableSince = 0;
        while (Date.now() < endTime) {
            const snap = getQuestionSnapshot();
            if (!snap.key) {
                await delay(120);
                continue;
            }
            if (snap.key !== lastKey) {
                lastKey = snap.key;
                stableSince = Date.now();
            } else if (Date.now() - stableSince >= minStableMs) {
                return snap;
            }
            await delay(120);
        }
        return getQuestionSnapshot();
    }

    function getNoImproveCache() {
        const value = storage.getGm(KEYS.gm.noImproveCache, []);
        if (Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(value || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function addToNoImproveCache(itemName) {
        if (!itemName) return;
        const list = getNoImproveCache();
        if (list.includes(itemName)) return;
        list.push(itemName);
        storage.setGm(KEYS.gm.noImproveCache, list);
        log(`已加入永久缓存(无去提升): ${itemName}`);
    }

    function getCurrentLearnItemName() {
        const node = document.querySelector(SELECTORS.learnPage.activeItemName);
        if (!node) return '';
        return (node.textContent || node.innerText || '').trim();
    }

    function getCurrentChapterKey() {
        const fromSession = storage.getSession(KEYS.session.currentChapterKey, '');
        if (fromSession) return fromSession;

        const fromGlobal = storage.getGm(KEYS.gm.currentChapterKeyGlobal, '');
        if (fromGlobal) return fromGlobal;

        const nodeName = new URLSearchParams(window.location.search).get('nodeName') || '';
        if (nodeName) return decodeURIComponent(nodeName);

        return storage.getSession(KEYS.session.lastAttemptedItem, '');
    }

    function setCurrentChapterKey(chapterKey) {
        const key = String(chapterKey || '').trim();
        if (!key) return;
        storage.setSession(KEYS.session.currentChapterKey, key);
        storage.setGm(KEYS.gm.currentChapterKeyGlobal, key);
    }

    function getChapterQaMemory() {
        const value = storage.getGm(KEYS.gm.chapterQaMemory, {});
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(value || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function saveChapterQaMemory(memory) {
        storage.setGm(KEYS.gm.chapterQaMemory, memory || {});
    }

    function mergeChapterQaRecords(chapterKey, records) {
        if (!chapterKey) return { added: 0, updated: 0, total: 0 };
        const memory = getChapterQaMemory();
        const existingList = Array.isArray(memory[chapterKey]) ? memory[chapterKey] : [];
        const beforeByKey = new Map();
        const incomingByKey = new Map();

        existingList.forEach(item => {
            const normalized = PureUtils.normalizeQaRecord(item, item?.updatedAt);
            const key = normalized ? PureUtils.normalizeQuestionKey(normalized.q) : '';
            if (key) beforeByKey.set(key, normalized);
        });

        (Array.isArray(records) ? records : []).forEach(item => {
            const normalized = PureUtils.normalizeQaRecord(item);
            const key = normalized ? PureUtils.normalizeQuestionKey(normalized.q) : '';
            if (key) incomingByKey.set(key, normalized);
        });

        const mergedList = PureUtils.mergeQaRecords(existingList, records, Date.now());
        memory[chapterKey] = mergedList;
        saveChapterQaMemory(memory);

        let added = 0;
        let updated = 0;
        incomingByKey.forEach((incoming, key) => {
            const previous = beforeByKey.get(key);
            if (!previous) {
                added += 1;
            } else if (previous.a !== incoming.a) {
                updated += 1;
            }
        });

        return { added, updated, total: mergedList.length };
    }

    function getChapterMemoryCount(chapterKey) {
        if (!chapterKey) return 0;
        const memory = getChapterQaMemory();
        const list = Array.isArray(memory[chapterKey]) ? memory[chapterKey] : [];
        return list.length;
    }

    function getChapterQaHints(chapterKey, currentQuestion, maxItems = 8) {
        if (!chapterKey) return [];
        const memory = getChapterQaMemory();
        const list = Array.isArray(memory[chapterKey]) ? memory[chapterKey] : [];
        if (list.length === 0) return [];
        return PureUtils.rankQaHints(list, currentQuestion, maxItems);
    }

    function previewText(text, maxLen = 60) {
        return PureUtils.previewText(text, maxLen);
    }

    function findClickableByText(keywords) {
        const candidates = document.querySelectorAll(SELECTORS.common.clickable);
        for (const el of candidates) {
            if (!isElementVisible(el)) continue;
            const text = (el.textContent || el.innerText || '').replace(/\s+/g, '');
            if (!text) continue;
            if (keywords.every(k => text.includes(k))) {
                const clickableParent = el.closest('a, button, .el-button, .van-button, [role="button"]');
                return clickableParent || el;
            }
        }
        return null;
    }

    function findExamPreviewUrlFromPage() {
        const links = document.querySelectorAll(SELECTORS.pointPage.examPreviewLinks);
        for (const a of links) {
            const href = a.getAttribute('href') || '';
            if (!href) continue;
            if (/^https?:\/\//i.test(href)) return href;
            if (href.startsWith('/')) return `${window.location.origin}${href}`;
        }
        return '';
    }

    function buildExamPreviewUrlFromPointUrl() {
        if (!window.location.href.includes('/point/')) return '';
        try {
            const url = new URL(window.location.href);
            const parts = url.pathname.split('/').filter(Boolean);
            // 期望: /point/{a}/{b}/{c}/{d}/{e}
            if (parts.length < 6 || parts[0] !== 'point') return '';
            parts[0] = 'examPreview';
            const previewPath = `/${parts.join('/')}`;
            return `${url.origin}${previewPath}${url.search || ''}`;
        } catch (e) {
            return '';
        }
    }

    function goToCourseList(reason) {
        const courseUrl = storage.getSession(KEYS.session.courseListUrl, '');
        if (courseUrl) {
            navigateTo(courseUrl, reason || '返回课程主页(singleCourse)继续筛选...', 'FLOW');
            return;
        }

        if (reason) log(reason, 'warn', 'FLOW');
        log('未记录课程主页URL，请手动回到课程页。', 'warn', 'FLOW');
    }

    function isOptionNodeChecked(optionNode) {
        if (!optionNode) return false;
        if (optionNode.classList.contains('is-checked') || optionNode.classList.contains('checked') || optionNode.classList.contains('selected') || optionNode.classList.contains('active')) {
            return true;
        }
        if (optionNode.getAttribute('aria-checked') === 'true') {
            return true;
        }
        const checkedParent = optionNode.closest('.is-checked, .checked, .selected, .active, [aria-checked="true"]');
        if (checkedParent) {
            return true;
        }
        if (optionNode.querySelector(SELECTORS.testPage.optionCheckedInputs)) {
            return true;
        }
        if (optionNode.querySelector('.is-checked, .checked, .selected, .active, [aria-checked="true"]')) {
            return true;
        }
        return false;
    }

    function areFillAnswersApplied(inputs, answers) {
        if (!inputs || inputs.length === 0) return false;
        for (let i = 0; i < inputs.length; i++) {
            const expected = String(answers?.[i] || '').trim();
            if (!expected) continue;
            const current = String(inputs[i].value || inputs[i].getAttribute('value') || '').trim();
            if (!current) return false;
        }
        return true;
    }

    function areExpectedOptionsSelected(qContent, answerLetters, qTypeText = '') {
        const optionNodes = qContent.querySelectorAll(SELECTORS.testPage.optionNodes);
        if (!optionNodes || optionNodes.length === 0) return false;

        const checkedCount = Array.from(optionNodes).filter(isOptionNodeChecked).length;
        const isSingleLike = String(qTypeText || '').includes('单选') || String(qTypeText || '').includes('判断');
        if (isSingleLike) {
            if (qContent.querySelector(SELECTORS.testPage.checkedFallback)) {
                return true;
            }
            if (document.querySelector(SELECTORS.testPage.anyCheckedGlobal)) {
                return true;
            }
            if (checkedCount === 0) return false;
            const target = String(answerLetters || '').trim().charAt(0);
            const idx = target.charCodeAt(0) - 65;
            if (idx >= 0 && idx < optionNodes.length && isOptionNodeChecked(optionNodes[idx])) {
                return true;
            }
            return checkedCount > 0;
        }

        for (const char of String(answerLetters || '')) {
            const idx = char.charCodeAt(0) - 65;
            if (idx < 0 || idx >= optionNodes.length) return false;
            if (!isOptionNodeChecked(optionNodes[idx])) return false;
        }
        return true;
    }

    function getCurrentQuestionContent() {
        return document.querySelector(SELECTORS.testPage.questionContent);
    }

    function clickOptionReliably(optionNode) {
        if (!optionNode) return;
        const inputEl = optionNode.querySelector(SELECTORS.testPage.optionClickableInput) || optionNode;
        reliableClick(optionNode);
        reliableClick(inputEl);

        const clickableParent = optionNode.closest('label, .el-radio, .el-checkbox, .option-item, .topic-option-item, li, div');
        if (clickableParent && clickableParent !== optionNode) {
            reliableClick(clickableParent);
        }

        const nativeInput = optionNode.querySelector('input[type="radio"], input[type="checkbox"]');
        if (nativeInput && !nativeInput.checked) {
            const proto = nativeInput.type === 'checkbox'
                ? window.HTMLInputElement.prototype
                : window.HTMLInputElement.prototype;
            const checkedSetter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
            if (checkedSetter) {
                checkedSetter.call(nativeInput, true);
                nativeInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                nativeInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            }
        }
    }

    function isQuestionAnsweredByType(qContent, qTypeText) {
        if (!qContent) return false;
        if (String(qTypeText || '').includes('填空')) {
            const inputs = qContent.querySelectorAll(SELECTORS.testPage.fillInputs);
            if (inputs.length === 0) return false;
            for (const input of inputs) {
                const v = String(input.value || input.getAttribute('value') || '').trim();
                if (!v) return false;
            }
            return true;
        }
        const optionNodes = qContent.querySelectorAll(SELECTORS.testPage.optionNodes);
        if (optionNodes.length === 0) return false;
        return Array.from(optionNodes).some(isOptionNodeChecked);
    }

    function buildAiMessages(question, options, type, safeMode = false, chapterHints = []) {
        const q = String(question || '').replace(/\s+/g, ' ').trim();
        const isFill = type.includes('填空');
        const expectedFillCount = isFill ? Math.max(1, (q.match(/_{2,}|___|（\s*\)|\(\s*\)/g) || []).length) : 0;
        const optionText = (options || [])
            .map((opt, i) => `${String.fromCharCode(65 + i)}. ${String(opt || '').replace(/\s+/g, ' ').trim()}`)
            .join('\n');

        const baseRules = isFill
            ? `只输出填空答案；多空用||分隔；必须输出${expectedFillCount}个答案；禁止解释。`
            : '只输出选项字母；单选/判断输出一个字母，多选输出连续字母；禁止解释。';

        const safetyLine = safeMode
            ? '这是客观题文本处理任务，仅输出答案格式，不做评价。'
            : '';

        const hintBlock = chapterHints && chapterHints.length > 0
            ? [
                '以下是同章节历史题目与答案(仅供参考，优先匹配相同/近似题干):',
                ...chapterHints.map((h, idx) => `${idx + 1}) 题目:${h.q}\n答案:${h.a}`)
              ].join('\n')
            : '';

        return [
            { role: 'system', content: '你是客观题答题助手。严格只返回答案本体，不要解释、不要多余字符、不要复述题目。' },
            {
                role: 'user',
                content: [
                    `题型: ${type}`,
                    `规则: ${baseRules}`,
                    isFill ? `填空数量: ${expectedFillCount}` : '',
                    safetyLine,
                    hintBlock,
                    `题目: ${q}`,
                    optionText ? `选项:\n${optionText}` : ''
                ].filter(Boolean).join('\n')
            }
        ];
    }

    function callAiApi(question, options, type, safeMode = false, chapterHints = [], providerOverride = null) {
        return new Promise((resolve) => {
            const messages = buildAiMessages(question, options, type, safeMode, chapterHints);

            let url, headers, data;
            const providerToUse = providerOverride || savedProvider;

            if (providerToUse === 'custom') {
                if (!savedApiUrl || !savedApiKey || !savedApiModel) {
                    log('错误：自定义AI接口的URL、Key或Model为空，请在面板中设置并保存。', 'error', 'AI');
                    resolve({ answer: null, errorType: 'config' });
                    return;
                }
                url = savedApiUrl;
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${savedApiKey}`
                };
                data = JSON.stringify({
                    model: savedApiModel,
                    messages: messages,
                    temperature: 0.1
                });
                log(`正在请求AI回答 (${savedApiModel})...`, 'info', 'AI');
            } else {
                url = 'https://api.coren.xin/zhipu-free-proxy';
                headers = { 'Content-Type': 'application/json' };
                data = JSON.stringify({ messages: messages });
                log('正在请求AI回答 (免费模型 GLM-4.5-Flash)...', 'info', 'AI');
            }

            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: headers,
                data: data,
                timeout: 15000,
                onload: function (response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const responseData = JSON.parse(response.responseText);
                            const content = responseData.choices?.[0]?.message?.content;
                            if (content === null || content === undefined) {
                                log(`API 返回错误: ${responseData.message || '内容为空'}`, 'warn');
                                resolve({ answer: null, errorType: 'empty' });
                                return;
                            }

                            let parsedAnswer = null;
                            if (type.includes('填空')) {
                                parsedAnswer = PureUtils.normalizeFillAnswerByQuestion(question, content);
                                log(`AI 填空题回答: ${parsedAnswer || '(空)'}`, 'info', 'AI');
                            } else {
                                parsedAnswer = PureUtils.parseChoiceAnswer(content, options, type);
                                log(`AI 回答: ${parsedAnswer || '(无法解析)'}`, 'info', 'AI');
                            }

                            resolve({ answer: parsedAnswer, errorType: parsedAnswer ? null : 'parse' });
                        } catch (e) {
                            log(`解析API响应失败: ${e.message}`, 'warn');
                            resolve({ answer: null, errorType: 'parse' });
                        }
                    } else {
                        let errorMsg = response.statusText || '';
                        try {
                            const errorData = JSON.parse(response.responseText);
                            errorMsg = errorData.error?.message || errorData.message || errorMsg;
                        } catch (e) {}

                        log(`API 请求失败: ${response.status} - ${errorMsg}`, 'warn', 'AI');

                        let errorType = 'http';
                        if (response.status === 429) errorType = 'rate_limit';
                        if (response.status === 400 && /敏感|不安全|unsafe|sensitive/i.test(errorMsg)) errorType = 'sensitive';
                        if (response.status >= 500) errorType = 'server';

                        resolve({ answer: null, errorType: errorType });
                    }
                },
                onerror: (error) => {
                    log(`API 调用出错: ${error.statusText || '网络错误'}`, 'warn', 'AI');
                    resolve({ answer: null, errorType: 'network' });
                },
                ontimeout: () => {
                    log('API 请求超时 (15秒)。', 'warn', 'AI');
                    resolve({ answer: null, errorType: 'timeout' });
                }
            });
        });
    }

    async function getAnswer(question, options, type) {
        const chapterKey = getCurrentChapterKey();
        log(`当前章节: ${chapterKey || '(空)'}`, 'debug', 'MEMORY');
        const chapterHints = getChapterQaHints(chapterKey, question, 8);
        if (chapterHints.length > 0) {
            log(`注入历史参考 ${chapterHints.length} 条。`, 'debug', 'MEMORY');
            chapterHints.forEach((h, idx) => {
                log(`提示样例${idx + 1}: 题="${previewText(h.q, 44)}" -> 答="${previewText(h.a, 30)}"`, 'debug', 'MEMORY');
            });
        } else {
            log('当前题未命中历史参考。', 'debug', 'MEMORY');
        }

        async function tryProvider(provider, attempts) {
            let safeMode = false;
            const providerLabel = provider === 'custom' ? '自定义模型' : '免费模型';

            const finalResult = await retryAsync(
                async (attempt) => {
                    const apiResult = await callAiApi(question, options, type, safeMode, chapterHints, provider);
                    if (apiResult.errorType === 'sensitive') {
                        safeMode = true;
                    }
                    if (apiResult.answer) {
                        return createResult(true, 'answer_ok', { answer: apiResult.answer, errorType: null });
                    }
                    return createResult(false, apiResult.errorType || 'unknown', { answer: null, errorType: apiResult.errorType || 'unknown' });
                },
                {
                    attempts,
                    shouldRetry: (result, attempt) => {
                        const failed = !result.ok;
                        if (failed && attempt < attempts) {
                            log(`${providerLabel} 第 ${attempt} 次失败，继续重试...`, 'warn', 'AI');
                        }
                        return failed && attempt < attempts;
                    },
                    getDelayMs: (result) => result?.data?.errorType === 'rate_limit' ? 4500 : 1500
                }
            );

            if (finalResult.ok) {
                return { answer: finalResult.data.answer, ok: true };
            }
            return { answer: null, ok: false };
        }

        if (savedProvider === 'custom') {
            const r = await tryProvider('custom', 3);
            if (r.ok) return r.answer;
            log('自定义模式下连续3次未收到有效答案，已中止。', 'error', 'AI');
            toggleAutoMode(false);
            return null;
        }

        const free = await tryProvider('free', 3);
        if (free.ok) return free.answer;

        log('免费模型连续3次失败，本题切换到自定义模型兜底。', 'warn', 'AI');
        const custom = await tryProvider('custom', 3);
        if (custom.ok) return custom.answer;

        log('免费+自定义均连续3次失败，已中止。', 'error', 'AI');
        toggleAutoMode(false);
        return null;
    }


    // --- 6. 页面处理逻辑 ---
    async function processTestPage() {
        log("进入答题页面，等待题目加载...");
        let lastSubmitAt = 0;

        async function trySubmitCheck(tag) {
            if (Date.now() - lastSubmitAt < 5000) return false;
            const submitButton = await waitForElement(SELECTORS.testPage.submitButton, 3000);
            if (!submitButton) return false;

            reliableClick(submitButton);
            lastSubmitAt = Date.now();
            log(`提交检查: ${tag}`, 'debug', 'SUBMIT');

            const startUrl = window.location.href;
            const end = Date.now() + 6000;
            while (Date.now() < end) {
                if (!window.location.href.includes('/studentReviewTestOrExam/')) {
                    log('提交成功并已跳转。', 'success', 'SUBMIT');
                    return true;
                }

                const dialog = Array.from(document.querySelectorAll(SELECTORS.common.dialogWrappers))
                    .find(d => d.style.display !== 'none' && getComputedStyle(d).display !== 'none');
                if (dialog) {
                    const t = dialog.innerText || '';
                    if (t.includes('未作答') || t.includes('未完成') || t.includes('还有') || t.includes('空白')) {
                        const cancelBtn = dialog.querySelector(SELECTORS.testPage.dialogCancelButton);
                        if (cancelBtn) reliableClick(cancelBtn);
                        log('网站提示仍有未作答，继续下一轮。', 'warn', 'SUBMIT');
                        return false;
                    }
                    const confirmBtn = dialog.querySelector(SELECTORS.testPage.dialogConfirmButton);
                    if (confirmBtn) {
                        reliableClick(confirmBtn);
                        log('提交确认弹窗已确认。', 'success', 'SUBMIT');
                        return true;
                    }
                }
                await delay(250);
            }

            log('提交检查未收到明确反馈，继续流程。', 'debug', 'SUBMIT');
            return window.location.href !== startUrl;
        }

        async function gotoFirstQuestion() {
            const byCard = document.querySelector(SELECTORS.testPage.answerCardFirstItem);
            if (byCard) {
                reliableClick(byCard);
                await delay(700);
                return true;
            }

            const cardEntry = Array.from(document.querySelectorAll(SELECTORS.testPage.answerCardEntryCandidates)).find(el => {
                if (!isElementVisible(el)) return false;
                const txt = (el.textContent || '').replace(/\s+/g, '');
                return txt.includes('答题卡');
            });
            if (!cardEntry) return false;

            reliableClick(cardEntry);
            await delay(500);
            const first = Array.from(document.querySelectorAll(SELECTORS.testPage.answerCardFirstNumberCandidates)).find(el => {
                if (!isElementVisible(el)) return false;
                const txt = (el.textContent || '').trim();
                return txt === '1' || txt === '1.' || txt === '1、';
            });
            if (!first) return false;
            reliableClick(first);
            await delay(700);
            return true;
        }

        async function answerCurrentQuestion(qContent) {
            if (!qContent) return { status: 'none' };

            // 再等一点，避免切题瞬间 DOM 还没同步导致误判未作答
            await delay(250);

            const qTitle = qContent.querySelector(SELECTORS.testPage.questionTitle)?.innerText.trim() || '';
            const qTypeText = qContent.querySelector(SELECTORS.testPage.questionType)?.innerText.trim() || '未知题型';
            if (!qTitle) return { status: 'none' };

            const hasAnswerBefore = isQuestionAnsweredByType(qContent, qTypeText);
            if (hasAnswerBefore) {
                log('当前题已存在作答痕迹，执行覆盖式作答以确保稳定。', 'debug', 'QUESTION');
            }

            log(`处理题目 (${qTypeText}): ${qTitle}`, 'info', 'QUESTION');

            if (qTypeText.includes('填空')) {
                const inputs = qContent.querySelectorAll(SELECTORS.testPage.fillInputs);
                if (inputs.length === 0) return { status: 'none' };
                const ansStr = await getAnswer(qTitle + ' (按顺序返回每空答案，多空用||分隔)', [], '填空题');
                if (!ansStr) return { status: 'none' };
                const ansList = ansStr.split('||').map(s => s.trim());
                for (let round = 1; round <= 2; round++) {
                    for (let i = 0; i < inputs.length; i++) {
                        if (!ansList[i]) continue;
                        log(`填入第 ${i + 1} 空: ${ansList[i]}${round > 1 ? ' (重试)' : ''}`, 'info', 'QUESTION');
                        setInputValueReliably(inputs[i], ansList[i]);
                        await delay(120);
                    }
                    await delay(220);
                    if (areFillAnswersApplied(inputs, ansList)) {
                        return { status: 'filled', stable: true };
                    }
                }
                log('填空答案回读不稳定，已按当前结果继续。', 'warn', 'QUESTION');
                return { status: 'filled', stable: false };
            }

            const optionNodes = qContent.querySelectorAll(SELECTORS.testPage.optionNodes);
            if (optionNodes.length === 0) return { status: 'none' };
            const optionsText = Array.from(optionNodes).map(el => {
                const preNode = el.querySelector(SELECTORS.testPage.optionTextNode);
                return preNode ? preNode.innerText.trim() : el.innerText.trim();
            });
            const answer = await getAnswer(qTitle, optionsText, qTypeText);
            if (!answer) return { status: 'none' };
            log(`选择答案: ${answer}`, 'info', 'QUESTION');

            const answerChars = String(answer || '').split('');
            for (let round = 1; round <= 4; round++) {
                const latestQuestion = getCurrentQuestionContent();
                if (!latestQuestion || !latestQuestion.isConnected) {
                    return { status: 'none' };
                }
                const latestOptions = latestQuestion.querySelectorAll(SELECTORS.testPage.optionNodes);
                if (!latestOptions || latestOptions.length === 0) {
                    return { status: 'none' };
                }

                for (const char of answerChars) {
                    const idx = char.charCodeAt(0) - 65;
                    if (idx < 0 || idx >= latestOptions.length) continue;
                    if (isOptionNodeChecked(latestOptions[idx])) continue;

                    clickOptionReliably(latestOptions[idx]);
                    await delay(220);
                }

                await delay(280);

                const latestAfter = getCurrentQuestionContent();
                if (!latestAfter || !latestAfter.isConnected) {
                    return { status: 'none' };
                }

                if (areExpectedOptionsSelected(latestAfter, answer, qTypeText)) {
                    return { status: 'filled', stable: true };
                }
            }

            log('选项状态回读不一致，继续执行并在提交环节做最终校验。', 'warn', 'QUESTION');
            return { status: 'filled', stable: false };
        }

        await gotoFirstQuestion();

        while (autoMode) {
            const stable = await waitForQuestionStable(320, 2500);
            const qContent = await waitForElement(SELECTORS.testPage.questionContent, 8000);
            if (!qContent) {
                log('未加载到题目区域，结束本轮。', 'warn', 'QUESTION');
                break;
            }

            const questionPreview = (qContent.querySelector(SELECTORS.testPage.questionTitle)?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 28);
            log(`开始作答当前题${questionPreview ? `: ${questionPreview}...` : ''}`, 'debug', 'QUESTION');
            const result = await answerCurrentQuestion(qContent);
            if (result?.status === 'none') {
                if (!autoMode) break;
                log('当前题未完成有效作答，尝试继续流程。', 'warn', 'QUESTION');
                continue;
            }

            if (!autoMode) break;

            const nextBtn = document.querySelector(SELECTORS.testPage.nextButton);
            if (!nextBtn) {
                log('已到最后一题，开始提交。', 'info', 'SUBMIT');
                break;
            }

            const currentKey = (stable && stable.key) ? stable.key : getQuestionSnapshot().key;
            log('点击下一题。', 'info', 'NAV');
            reliableClick(nextBtn);
            const changed = await waitForQuestionChange(currentKey, 4500, 180);
            if (!changed) {
                await delay(700);
            }
        }

        if (autoMode) {
            const done = await trySubmitCheck('顺序答题完成');
            if (!done) {
                log('提交未成功，返回第一题重做一轮。', 'warn', 'SUBMIT');
                const restarted = await gotoFirstQuestion();
                if (restarted) {
                    while (autoMode) {
                        const stable = await waitForQuestionStable(320, 2500);
                        const qContent = await waitForElement(SELECTORS.testPage.questionContent, 8000);
                        if (!qContent) {
                            log('重做轮未加载到题目区域，结束。', 'warn', 'QUESTION');
                            break;
                        }

                        const questionPreview = (qContent.querySelector(SELECTORS.testPage.questionTitle)?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 28);
                        log(`重做当前题${questionPreview ? `: ${questionPreview}...` : ''}`, 'debug', 'QUESTION');
                        const result = await answerCurrentQuestion(qContent);
                        if (result?.status === 'none') {
                            if (!autoMode) break;
                            log('重做轮当前题未完成有效作答，继续后续流程。', 'warn', 'QUESTION');
                            continue;
                        }

                        if (!autoMode) break;

                        const nextBtn = document.querySelector(SELECTORS.testPage.nextButton);
                        if (!nextBtn) {
                            log('重做轮到达最后一题，尝试再次提交。', 'info', 'SUBMIT');
                            break;
                        }

                        const currentKey = (stable && stable.key) ? stable.key : getQuestionSnapshot().key;
                        reliableClick(nextBtn);
                        const changed = await waitForQuestionChange(currentKey, 4500, 180);
                        if (!changed) {
                            await delay(700);
                        }
                    }

                    const done2 = await trySubmitCheck('重做轮完成');
                    if (!done2) {
                        log('重做轮提交仍未得到明确反馈。', 'warn', 'SUBMIT');
                    }
                } else {
                    log('无法回到第一题，重做轮未执行。', 'warn', 'SUBMIT');
                }
            }
        }
    }



    // 主页逻辑：自动悬停并点击"提升掌握度"按钮
    async function findAndScrollToIncompleteItem() {
        log("正在等待课程列表加载...");
        const foundItems = await waitForElement(SELECTORS.learnPage.itemContent, 15000);
        if (!foundItems) {
            log("未能找到知识点列表，可能当前页面不是课程主页或网络极慢。");
            return;
        }
        await delay(1000); // 给它一点时间渲染进度条
        
        const items = document.querySelectorAll(SELECTORS.learnPage.itemContent);
        log(`找到 ${items.length} 个知识点项`);
        
        let validItems = [];
        let index = 0;
        const noImproveCache = getNoImproveCache();

        for(let item of items) {
            const pctNode = item.querySelector(SELECTORS.learnPage.progressText);
            let pct = 0;
            if(pctNode) {
                const parsed = parseInt(pctNode.innerText.trim(), 10);
                if(!isNaN(parsed)) pct = parsed;
            }
            
            const titleNode = item.querySelector(SELECTORS.learnPage.itemTitle);
            const itemName = titleNode ? titleNode.innerText.trim() : ('未知知识点' + index);

            if(pct < 100 && !noImproveCache.includes(itemName)) {
                validItems.push({ element: item, pct: pct, index: index, name: itemName });
            }
            index++;
        }

        if (validItems.length > 0) {
            // 优先进入掌握度最低的章节，如果掌握度相同，选择最靠前的
            validItems.sort((a, b) => {
                if (a.pct !== b.pct) {
                    return a.pct - b.pct;
                }
                return a.index - b.index;
            });
            const target = validItems[0];
            const targetItem = target.element;
            const itemName = target.name;

            log(`优先级最高目标: "${itemName}" (掌握度: ${target.pct}%)，准备点击`);
            storage.setSession(KEYS.session.lastAttemptedItem, itemName);
            setCurrentChapterKey(itemName);
            
            targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await delay(500);
            
            const titleNode = targetItem.querySelector(SELECTORS.learnPage.itemTitle);
            if(titleNode) {
                reliableClick(titleNode);
            } else {
                reliableClick(targetItem);
            }
            log(`已点击进入知识点学习页，等待加载...`);
        } else {
            log("当前页面没有未满100%的有效知识点，或都在无去提升缓存中，任务结束。");
            toggleAutoMode(false);
        }
    }

    async function handleLearnPage() {
        log("当前在 learnPage，寻找「去提升」按钮...");
        const chapterKey = getCurrentChapterKey();
        if (chapterKey) {
            setCurrentChapterKey(chapterKey);
            const memoryCount = getChapterMemoryCount(chapterKey);
            log(`当前章节记忆库条数: ${memoryCount}`, 'debug');
        }
        const timeout = Date.now() + 8000;
        let btn = null;
        while (Date.now() < timeout) {
            btn = findImproveButton();
            if (btn) break;
            await delay(500);
        }

        if (btn) {
            const currentItemName = getCurrentLearnItemName();
            if (currentItemName) {
                storage.setSession(KEYS.session.lastAttemptedItem, currentItemName);
            }
            const btnText = (btn.textContent || btn.innerText || '').trim();
            log(`找到可点击按钮: "${btnText}"，准备点击...`, 'debug');
            reliableClick(btn);
            return;
        }

        const currentItemName = getCurrentLearnItemName() || storage.getSession(KEYS.session.lastAttemptedItem, '') || '';
        if (currentItemName) {
            addToNoImproveCache(currentItemName);
        } else {
            log('未能识别当前章节名，但已判定本页无去提升。');
        }
        goToCourseList('当前 learnPage 无「去提升」，回 singleCourse 重新找高优先级章节...');
    }

    async function processMasteryHistory() {
        log("进入历史掌握度页面，寻找「去提升」按钮...");
        await delay(2000);
        const btn = document.querySelector(SELECTORS.learnPage.improveButtonDirect);
        if(btn) {
            log("找到「去提升」按钮，准备点击...");
            reliableClick(btn);
        } else {
            log("未找到「去提升」按钮，如果已满分将停止。");
            if(autoMode) setTimeout(processMasteryHistory, 3000);
        }
    }

    async function processPointPage() {
        log("进入知识点结算页面，等待成绩加载...");
        await delay(2000); // 给点时间看成绩

        // 优先按URL规则直接构造解析页地址，避免按钮点击失效导致卡住
        const derivedPreviewUrl = buildExamPreviewUrlFromPointUrl();
        if (derivedPreviewUrl) {
            navigateTo(derivedPreviewUrl, '已根据 point 链接构造 examPreview 地址，准备直接跳转采集...', 'NAV');
            return;
        }

        const directPreviewUrl = findExamPreviewUrlFromPage();
        if (directPreviewUrl) {
            navigateTo(directPreviewUrl, '检测到解析页直达链接，准备直接跳转采集...', 'NAV');
            return;
        }

        const previewBtn = findClickableByText(['查看', '作答', '记录']) || findClickableByText(['查看', '解析']);
        if (previewBtn) {
            log('检测到可查看作答记录入口，准备采集题目与答案用于后续同章节增强。', 'debug');
            reliableClick(previewBtn);
            const changed = await waitForUrlChange(window.location.href, 8000, 400);
            if (changed) return;
            log('点击查看作答记录后未发生跳转，可能入口不可点击，回课程主页继续。', 'warn');
            goToCourseList('结算页采集入口点击无效，回 singleCourse 继续执行...');
            return;
        }

        const fallbackPreviewUrl = storage.getSession(KEYS.session.lastExamPreviewUrl, '');
        if (fallbackPreviewUrl) {
            navigateTo(fallbackPreviewUrl, '当前页未找到解析入口，尝试使用历史解析链接进行采集...', 'NAV');
            return;
        }

        goToCourseList('结算页处理完成，返回 singleCourse 继续按优先级找题...');
    }

    async function processExamPreviewPage() {
        const chapterKey = getCurrentChapterKey();
        if (chapterKey) setCurrentChapterKey(chapterKey);
        storage.setSession(KEYS.session.lastExamPreviewUrl, window.location.href);
        log(`进入答题解析页，开始提取题目答案记录...${chapterKey ? ` (章节: ${chapterKey})` : ''}`, 'debug');
        await delay(2000);

        const questionBlocks = document.querySelectorAll(SELECTORS.previewPage.questionBlocks);
        const extractedRecords = [];

        const normalizeLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        const cleanQuestion = (s) => normalizeLine(s).replace(/^\d+[、.．]\s*/, '');

        questionBlocks.forEach(block => {
            const qNode = block.querySelector(SELECTORS.previewPage.questionTitle);
            const q = qNode ? cleanQuestion(qNode.textContent || qNode.innerText || '') : '';

            // 优先提取“参考答案”，避免把用户错误作答写入记忆库
            const referenceAnswerSpans = block.querySelectorAll(SELECTORS.previewPage.referenceAnswerSpans);
            let a = '';
            if (referenceAnswerSpans.length > 0) {
                const refs = Array.from(referenceAnswerSpans)
                    .map(el => normalizeLine(el.textContent || el.innerText || ''))
                    .filter(Boolean);
                if (refs.length > 0) {
                    a = refs.join('||');
                }
            }

            if (!a) {
                const answerTitleNode = block.querySelector(SELECTORS.previewPage.answerTitle);
                if (answerTitleNode) {
                    const titleText = normalizeLine(answerTitleNode.textContent || answerTitleNode.innerText || '');
                    const matched = titleText.match(/参考答案[:：]\s*(.+)$/);
                    if (matched && matched[1]) {
                        a = normalizeLine(matched[1]);
                    }
                }
            }

            if (!a) {
                const aNode = block.querySelector(SELECTORS.previewPage.answerFallback);
                a = aNode ? normalizeLine(aNode.textContent || aNode.innerText || '') : '';
            }

            if (!a) {
                const checked = block.querySelectorAll(SELECTORS.previewPage.checkedFallback);
                if (checked.length > 0) {
                    const labels = [];
                    checked.forEach(el => {
                        const txt = (el.textContent || el.innerText || '').trim();
                        if (txt) labels.push(txt);
                    });
                    if (labels.length > 0) a = labels.join(' || ');
                }
            }

            const isErrorResult = !!block.querySelector(SELECTORS.previewPage.errorResult);
            if (isErrorResult && !block.querySelector(SELECTORS.previewPage.answerTitle)) {
                // 错题且无参考答案时，不记录用户答案，防止污染记忆库
                a = '';
            }

            if (q && a && chapterKey) {
                extractedRecords.push({ q, a });
            }
        });

        if (chapterKey && extractedRecords.length > 0) {
            const stats = mergeChapterQaRecords(chapterKey, extractedRecords);
            log(`已合并章节记忆库，新增 ${stats.added} 条，更新 ${stats.updated} 条，累计 ${stats.total} 条。`, 'info');
        } else {
            log('未提取到有效题目答案记录（可能页面结构不同）。', 'warn');
        }

        goToCourseList('解析页采集完成，返回课程主页继续执行...');
    }

    const routeHandlers = [
        {
            key: 'singleCourse',
            match: '/singleCourse/',
            onEnter: (url) => {
                storage.setSession(KEYS.session.courseListUrl, url);
            },
            run: () => findAndScrollToIncompleteItem(),
            onError: (err) => log(`singleCourse处理异常: ${err.message}`)
        },
        {
            key: 'learnPage',
            match: '/learnPage/',
            run: () => handleLearnPage(),
            onError: (err) => {
                log(`learnPage处理异常: ${err.message}`);
                goToCourseList('learnPage异常，回课程主页继续执行...');
            }
        },
        {
            key: 'masteryHistory',
            match: '/masteryHistory/',
            run: () => processMasteryHistory(),
            onError: (err) => log(`masteryHistory处理异常: ${err.message}`)
        },
        {
            key: 'reviewTest',
            match: '/studentReviewTestOrExam/',
            run: () => processTestPage(),
            onError: (err) => log(`答题页处理异常: ${err.message}`)
        },
        {
            key: 'point',
            match: '/point/',
            run: () => processPointPage(),
            onError: (err) => {
                log(`结算页处理异常: ${err.message}`);
                goToCourseList('结算页异常，回课程主页继续执行...');
            }
        },
        {
            key: 'examPreview',
            match: '/examPreview/',
            run: () => processExamPreviewPage(),
            onError: (err) => {
                log(`解析页处理异常: ${err.message}`, 'error');
                goToCourseList('解析页异常，回课程主页继续执行...');
            }
        }
    ];

    function mainLoop() {
        if (!autoMode) return;
        const currentUrl = window.location.href;

        const matchedRoute = routeHandlers.find(route => currentUrl.includes(route.match));
        if (matchedRoute) {
            if (matchedRoute.onEnter) {
                matchedRoute.onEnter(currentUrl);
            }
            matchedRoute.run().catch(matchedRoute.onError);
            return;
        }

        if (currentUrl.includes('/mySpace/')) {
            log('当前在 mySpace，请先手动进入某个课程的 singleCourse 页面。');
            return;
        }

        log('当前页面不在课程流程内，请手动进入 singleCourse 页面。');
    }

    function toggleAutoMode(start) {
        autoMode = start;
        storage.setGm(KEYS.gm.autoMode, start);
        if (autoMode) {
            clearLogBuffer();
            // 启动后不清空永久缓存，只重置本轮状态
            storage.removeSession(KEYS.session.lastAttemptedItem);
            
            startButton.textContent = '停止自动答题';
            startButton.style.backgroundColor = '#dc3545';
            log('自动答题已开始！(永久无去提升缓存已保留)');
            mainLoop();
        } else {
            startButton.textContent = '开始自动答题';
            startButton.style.backgroundColor = '#198754';
            log('自动答题已停止。');
        }
    }

    // --- 6. 启动脚本和监听器 ---
    let lastUrl = location.href;
    let navTimeout = null;
    
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            log(`URL 变动: ${url}`);
            if (autoMode) {
                // 加入防抖(Debounce)，防止中间过程的无用跳转触发多次逻辑
                if (navTimeout) clearTimeout(navTimeout);
                navTimeout = setTimeout(() => {
                    mainLoop();
                }, 2500); 
            }
        }
    }).observe(document, { subtree: true, childList: true });

    window.addEventListener('load', () => {
        renderLogBuffer();
        log("AI答题脚本已加载。点击上方按钮开始自动答题。", 'debug');
        
        // 恢复自动答题状态
        if (autoMode) {
            startButton.textContent = '停止自动答题';
            startButton.style.backgroundColor = '#dc3545';
            log('检测到自动答题状态开启，继续执行...');
            setTimeout(mainLoop, 2000);
        }
    }, false);

})();
}
