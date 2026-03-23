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
        #status-log { margin-top: 15px; padding: 10px; background-color: #f8f9fa; border-radius: 6px; height: 260px; overflow-y: auto; font-size: 12px; color: #495057; border: 1px solid #dee2e6; box-shadow: inset 0 1px 3px rgba(0,0,0,0.04); }
        #status-log div { margin-bottom: 6px; line-height: 1.4; word-break: break-all; border-bottom: 1px dashed #f1f3f5; padding-bottom: 4px; }
        #status-log div:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
        #status-log .time { color: #adb5bd; margin-right: 6px; font-family: monospace; font-size: 11px; }
        #status-log .level { display: inline-block; min-width: 50px; font-family: monospace; margin-right: 4px; }
        #status-log .log-debug { background: #f1f3f5; border-left: 3px solid #adb5bd; padding-left: 6px; }
        #status-log .log-info { background: #eef6ff; border-left: 3px solid #0d6efd; padding-left: 6px; }
        #status-log .log-warn { background: #fff6e9; border-left: 3px solid #fd7e14; padding-left: 6px; }
        #status-log .log-error { background: #fff1f3; border-left: 3px solid #dc3545; padding-left: 6px; }
        #status-log .log-debug .level { color: #6c757d; }
        #status-log .log-info .level { color: #0d6efd; }
        #status-log .log-warn .level { color: #fd7e14; }
        #status-log .log-error .level { color: #dc3545; }
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
    const LOG_BUFFER_KEY = 'runtime_log_buffer_v1';
    const LOG_BUFFER_MAX = 300;
    
    // 自定义AI设置相关的元素
    const providerSelect = document.getElementById('ai-provider');
    const customSettingsDiv = document.getElementById('custom-ai-settings');
    const apiUrlInput = document.getElementById('ai-url');
    const apiKeyInput = document.getElementById('ai-key');
    const apiModelInput = document.getElementById('ai-model');
    const saveSettingsBtn = document.getElementById('save-settings');

    let isPanelVisible = GM_getValue('panel_visible_state', true); // 默认开启
    let autoMode = GM_getValue('autoMode_state', false);

    // 初始化面板可见性
    if (isPanelVisible) {
        panel.classList.add('show');
        toggleButton.textContent = 'X';
    } else {
        panel.classList.remove('show');
        toggleButton.textContent = 'AI';
    }
    
    // 读取持久化的AI设置
    let savedProvider = GM_getValue('ai_provider', 'free');
    let savedApiUrl = GM_getValue('ai_url', '');
    let savedApiKey = GM_getValue('ai_key', '');
    let savedApiModel = GM_getValue('ai_model', '');

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
        GM_setValue('ai_provider', savedProvider); // 切换时直接保存模式
        
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
        
        GM_setValue('ai_url', savedApiUrl);
        GM_setValue('ai_key', savedApiKey);
        GM_setValue('ai_model', savedApiModel);
        
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
            GM_setValue('panel_pos_left', dragContainer.style.left);
            GM_setValue('panel_pos_top', dragContainer.style.top);
        }
    });

    toggleButton.addEventListener('click', (e) => {
        if (hasDragged) {
            hasDragged = false;
            return;
        }
        isPanelVisible = !isPanelVisible;
        GM_setValue('panel_visible_state', isPanelVisible);
        panel.classList.toggle('show', isPanelVisible);
        toggleButton.textContent = isPanelVisible ? 'X' : 'AI';
    });

    startButton.addEventListener('click', () => toggleAutoMode(!autoMode));

    // --- 4. 核心功能函数 ---
    function getLogBuffer() {
        const value = GM_getValue(LOG_BUFFER_KEY, []);
        if (Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(value || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function saveLogBuffer(buffer) {
        GM_setValue(LOG_BUFFER_KEY, buffer.slice(-LOG_BUFFER_MAX));
    }

    function clearLogBuffer() {
        GM_setValue(LOG_BUFFER_KEY, []);
        statusLog.innerHTML = '';
    }

    function renderLogEntry(entry) {
        const safeLevel = String(entry.level || 'info').toLowerCase();
        const safeTag = safeLevel.toUpperCase();
        const safeTime = entry.time || new Date().toLocaleTimeString();
        const safeMsg = String(entry.message || '');
        statusLog.innerHTML += `<div class="log-${safeLevel}"><span class="time">[${safeTime}]</span><span class="level">[${safeTag}]</span>${safeMsg}</div>`;
    }

    function renderLogBuffer() {
        statusLog.innerHTML = '';
        const buffer = getLogBuffer();
        for (const entry of buffer) {
            renderLogEntry(entry);
        }
        statusLog.scrollTop = statusLog.scrollHeight;
    }

    function log(message, level = 'info') {
        const lv = String(level || 'info').toLowerCase();
        const levelTag = lv.toUpperCase();
        console.log(`[AI脚本][${levelTag}] ${message}`);
        const timestamp = new Date().toLocaleTimeString();

        const entry = { time: timestamp, level: lv, message: message };
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
        const selectors = ['.simplified-mastery__action', '.improve-btn', 'button', '.el-button', '.van-button'];
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
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: unsafeWindow });
        element.dispatchEvent(clickEvent);
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
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        return null;
    }

    const NO_IMPROVE_CACHE_KEY = 'no_improve_cache_v1';
    const CHAPTER_QA_MEMORY_KEY = 'chapter_qa_memory_v1';
    const CURRENT_CHAPTER_KEY = 'current_chapter_key_global_v1';

    function getNoImproveCache() {
        const value = GM_getValue(NO_IMPROVE_CACHE_KEY, []);
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
        GM_setValue(NO_IMPROVE_CACHE_KEY, list);
        log(`已加入永久缓存(无去提升): ${itemName}`);
    }

    function getCurrentLearnItemName() {
        const node = document.querySelector('.title-text.active, .item-title.active, .section-item-collapse-info.active .title-text, .item-content.active .item-title');
        if (!node) return '';
        return (node.textContent || node.innerText || '').trim();
    }

    function getCurrentChapterKey() {
        const fromSession = sessionStorage.getItem('current_chapter_key') || '';
        if (fromSession) return fromSession;

        const fromGlobal = GM_getValue(CURRENT_CHAPTER_KEY, '');
        if (fromGlobal) return fromGlobal;

        const nodeName = new URLSearchParams(window.location.search).get('nodeName') || '';
        if (nodeName) return decodeURIComponent(nodeName);

        return sessionStorage.getItem('last_attempted_item') || '';
    }

    function setCurrentChapterKey(chapterKey) {
        const key = String(chapterKey || '').trim();
        if (!key) return;
        sessionStorage.setItem('current_chapter_key', key);
        GM_setValue(CURRENT_CHAPTER_KEY, key);
    }

    function getChapterQaMemory() {
        const value = GM_getValue(CHAPTER_QA_MEMORY_KEY, {});
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        try {
            const parsed = JSON.parse(value || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function saveChapterQaMemory(memory) {
        GM_setValue(CHAPTER_QA_MEMORY_KEY, memory || {});
    }

    function replaceChapterQaRecords(chapterKey, records) {
        if (!chapterKey) return 0;
        const memory = getChapterQaMemory();
        const uniqMap = new Map();

        (records || []).forEach(item => {
            const q = String(item?.q || '').replace(/\s+/g, ' ').trim();
            const a = String(item?.a || '').replace(/\s+/g, ' ').trim();
            if (!q || !a) return;
            uniqMap.set(q, { q, a, updatedAt: Date.now() });
        });

        const finalList = Array.from(uniqMap.values()).slice(-150);
        memory[chapterKey] = finalList;
        saveChapterQaMemory(memory);
        return finalList.length;
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

        const normalizedCurrent = normalizeTextForMatch(currentQuestion || '');
        const scored = list.map(item => {
            const nq = normalizeTextForMatch(item.q || '');
            let score = 0;
            if (normalizedCurrent && nq) {
                if (normalizedCurrent.includes(nq) || nq.includes(normalizedCurrent)) {
                    score += 5;
                }
                const sameChars = new Set(nq.split('')).size;
                score += Math.min(3, sameChars > 0 ? Math.floor((nq.length && normalizedCurrent.length ? Math.min(nq.length, normalizedCurrent.length) : 0) / 20) : 0);
            }
            score += item.updatedAt ? 1 : 0;
            return { item, score };
        });

        scored.sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0));
        return scored.slice(0, maxItems).map(x => x.item);
    }

    function previewText(text, maxLen = 60) {
        const s = String(text || '').replace(/\s+/g, ' ').trim();
        if (s.length <= maxLen) return s;
        return `${s.slice(0, maxLen)}...`;
    }

    function findClickableByText(keywords) {
        const candidates = document.querySelectorAll('a, button, .el-button, .van-button, [role="button"], span, div');
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
        const links = document.querySelectorAll('a[href*="/examPreview/"]');
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
        if (reason) log(reason);
        const courseUrl = sessionStorage.getItem('course_list_url');
        if (courseUrl) {
            log('返回课程主页(singleCourse)继续筛选...');
            window.location.href = courseUrl;
        } else {
            log('未记录课程主页URL，请手动回到课程页。');
        }
    }

    function isQuestionAnswered(qContent) {
        if (!qContent) return false;

        const fillInputs = qContent.querySelectorAll('.input-ques .fillAnswer input.el-input__inner, .input-ques .fillAnswer textarea.el-textarea__inner, input[type="text"], textarea');
        if (fillInputs.length > 0) {
            for (const input of fillInputs) {
                if (!input.value || input.value.trim() === '') return false;
            }
            return true;
        }

        const checkedOptions = qContent.querySelectorAll('.is-checked, input[type="radio"]:checked, input[type="checkbox"]:checked');
        if (checkedOptions.length > 0) return true;

        return false;
    }

    function normalizeFullWidthLetters(text) {
        return String(text || '').replace(/[Ａ-Ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 65248));
    }

    function normalizeTextForMatch(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[，。、“”‘’【】（）()《》：:；;,.!?！？'"`]/g, '');
    }

    function parseChoiceAnswer(rawContent, options, type) {
        let text = normalizeFullWidthLetters(rawContent).trim();

        if (type.includes('判断')) {
            if (/对|正确|\btrue\b|\bT\b|√/i.test(text)) return 'A';
            if (/错|错误|\bfalse\b|\bF\b|×/i.test(text)) return 'B';
        }

        let letters = text.toUpperCase().replace(/[^A-Z]/g, '');

        if (!letters && options && options.length > 0) {
            const normalizedReply = normalizeTextForMatch(text);
            let matched = '';
            options.forEach((opt, index) => {
                const normOpt = normalizeTextForMatch(opt);
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
    }

    function parseFillAnswer(rawContent) {
        let text = String(rawContent || '').trim();
        text = text.replace(/^答案[:：]?\s*/i, '');
        text = text.replace(/^填空答案[:：]?\s*/i, '');
        text = text.replace(/\r?\n+/g, '||');
        return text || null;
    }

    function buildAiMessages(question, options, type, safeMode = false, chapterHints = []) {
        const q = String(question || '').replace(/\s+/g, ' ').trim();
        const optionText = (options || [])
            .map((opt, i) => `${String.fromCharCode(65 + i)}. ${String(opt || '').replace(/\s+/g, ' ').trim()}`)
            .join('\n');

        const baseRules = type.includes('填空')
            ? '只输出填空答案；多空用||分隔；禁止解释。'
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
            { role: 'system', content: '你是客观题答题助手，只返回最终答案，不要解释。' },
            {
                role: 'user',
                content: [
                    `题型: ${type}`,
                    `规则: ${baseRules}`,
                    safetyLine,
                    hintBlock,
                    `题目: ${q}`,
                    optionText ? `选项:\n${optionText}` : ''
                ].filter(Boolean).join('\n')
            }
        ];
    }

    function callAiApi(question, options, type, safeMode = false, chapterHints = []) {
        return new Promise((resolve) => {
            const messages = buildAiMessages(question, options, type, safeMode, chapterHints);

            let url, headers, data;

            if (savedProvider === 'custom') {
                if (!savedApiUrl || !savedApiKey || !savedApiModel) {
                    log('错误：自定义AI接口的URL、Key或Model为空，请在面板中设置并保存。', 'error');
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
                log(`正在请求AI回答 (${savedApiModel})...`);
            } else {
                url = 'https://api.coren.xin/zhipu-free-proxy';
                headers = { 'Content-Type': 'application/json' };
                data = JSON.stringify({ messages: messages });
                log('正在请求AI回答 (免费模型 GLM-4.5-Flash)...');
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
                                parsedAnswer = parseFillAnswer(content);
                                log(`AI 填空题回答: ${parsedAnswer || '(空)'}`);
                            } else {
                                parsedAnswer = parseChoiceAnswer(content, options, type);
                                log(`AI 回答: ${parsedAnswer || '(无法解析)'}`);
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

                        log(`API 请求失败: ${response.status} - ${errorMsg}`);

                        let errorType = 'http';
                        if (response.status === 429) errorType = 'rate_limit';
                        if (response.status === 400 && /敏感|不安全|unsafe|sensitive/i.test(errorMsg)) errorType = 'sensitive';
                        if (response.status >= 500) errorType = 'server';

                        resolve({ answer: null, errorType: errorType });
                    }
                },
                onerror: (error) => {
                    log(`API 调用出错: ${error.statusText || '网络错误'}`);
                    resolve({ answer: null, errorType: 'network' });
                },
                ontimeout: () => {
                    log('API 请求超时 (15秒)。');
                    resolve({ answer: null, errorType: 'timeout' });
                }
            });
        });
    }

    // --- 总的答案获取调度函数 ---
    async function getAnswer(question, options, type, retries = 3) {
        let safeMode = false;
        const chapterKey = getCurrentChapterKey();
        log(`当前答题章节Key: ${chapterKey || '(空)'}`, 'debug');
        const chapterHints = getChapterQaHints(chapterKey, question, 8);
        if (chapterHints.length > 0) {
            log(`已注入同章节历史答案参考 ${chapterHints.length} 条。`, 'debug');
            chapterHints.forEach((h, idx) => {
                log(`提示样例${idx + 1}: 题="${previewText(h.q, 44)}" -> 答="${previewText(h.a, 30)}"`, 'debug');
            });
        } else {
            log('当前题未命中章节记忆库提示。', 'debug');
        }
        for (let i = 0; i < retries; i++) {
            const result = await callAiApi(question, options, type, safeMode, chapterHints);
            if (result.answer) return result.answer;

            if (result.errorType === 'sensitive') {
                safeMode = true;
                log('检测到敏感拦截，已切换到更保守的提示词重试...', 'warn');
            }

            const waitMs = result.errorType === 'rate_limit' ? 4500 : 2000;
            log(`AI 第 ${i + 1} 次尝试失败，准备重试...`, 'warn');
            await new Promise(r => setTimeout(r, waitMs));
        }
        return null;
    }


    // --- 6. 页面处理逻辑 ---
    async function processTestPage() {
        log("进入答题页面，等待题目加载...");
        let pass = 1;
        let lastSubmitAt = 0;

        async function trySubmitCheck(tag) {
            if (Date.now() - lastSubmitAt < 5000) return false;
            const submitButton = await waitForElement('.reviewDone', 3000);
            if (!submitButton) return false;

            reliableClick(submitButton);
            lastSubmitAt = Date.now();
            log(`提交检查(${tag})`, 'debug');

            const startUrl = window.location.href;
            const end = Date.now() + 6000;
            while (Date.now() < end) {
                if (!window.location.href.includes('/studentReviewTestOrExam/')) {
                    log('提交成功并已跳转。');
                    return true;
                }

                const dialog = Array.from(document.querySelectorAll('.el-dialog__wrapper, .el-message-box__wrapper, .van-dialog'))
                    .find(d => d.style.display !== 'none' && getComputedStyle(d).display !== 'none');
                if (dialog) {
                    const t = dialog.innerText || '';
                    if (t.includes('未作答') || t.includes('未完成') || t.includes('还有') || t.includes('空白')) {
                        const cancelBtn = dialog.querySelector('.cancel.button') || dialog.querySelector('.el-button--default') || dialog.querySelector('.van-dialog__cancel');
                        if (cancelBtn) reliableClick(cancelBtn);
                        return false;
                    }
                    const confirmBtn = dialog.querySelector('.comfirm.button') || dialog.querySelector('.el-button--primary') || dialog.querySelector('.van-dialog__confirm');
                    if (confirmBtn) {
                        reliableClick(confirmBtn);
                        return true;
                    }
                }
                await new Promise(r => setTimeout(r, 250));
            }

            return window.location.href !== startUrl;
        }

        async function gotoFirstQuestion() {
            const byCard = document.querySelector('.answerCard .answer-item, .topic-list .topic-item, .card-list li, .answer-sheet li, .sheet-list li, .question-card li, .topic-card-item');
            if (byCard) {
                reliableClick(byCard);
                await new Promise(r => setTimeout(r, 700));
                return true;
            }

            const cardEntry = Array.from(document.querySelectorAll('button, a, span, div, .el-button, [role="button"]')).find(el => {
                if (!isElementVisible(el)) return false;
                const txt = (el.textContent || '').replace(/\s+/g, '');
                return txt.includes('答题卡');
            });
            if (!cardEntry) return false;

            reliableClick(cardEntry);
            await new Promise(r => setTimeout(r, 500));
            const first = Array.from(document.querySelectorAll('li, button, a, span, div')).find(el => {
                if (!isElementVisible(el)) return false;
                const txt = (el.textContent || '').trim();
                return txt === '1' || txt === '1.' || txt === '1、';
            });
            if (!first) return false;
            reliableClick(first);
            await new Promise(r => setTimeout(r, 700));
            return true;
        }

        async function answerCurrentQuestion() {
            const qContent = await waitForElement('.questionContent', 10000);
            if (!qContent) return false;

            if (isQuestionAnswered(qContent)) {
                log('当前题目已作答，跳过。');
                return true;
            }

            const qTitle = qContent.querySelector('.centent-pre pre.preStyle')?.innerText.trim() || '';
            const qTypeText = qContent.querySelector('.letterSortNum')?.innerText.trim() || '未知题型';
            if (!qTitle) return false;

            log(`处理题目 (${qTypeText}): ${qTitle}`);

            if (qTypeText.includes('填空')) {
                const inputs = qContent.querySelectorAll('.input-ques .fillAnswer input.el-input__inner, .input-ques .fillAnswer textarea.el-textarea__inner');
                if (inputs.length === 0) return false;
                const ansStr = await getAnswer(qTitle + ' (按顺序返回每空答案，多空用||分隔)', [], '填空题', 1);
                if (!ansStr) return false;
                const ansList = ansStr.split('||').map(s => s.trim());
                for (let i = 0; i < inputs.length; i++) {
                    if (!ansList[i]) continue;
                    setInputValueReliably(inputs[i], ansList[i]);
                    await new Promise(r => setTimeout(r, 100));
                }
                return true;
            }

            const optionNodes = qContent.querySelectorAll('.el-radio, .el-checkbox, .option-item, .topic-option-item, ul.radio-view li');
            if (optionNodes.length === 0) return false;
            const optionsText = Array.from(optionNodes).map(el => {
                const preNode = el.querySelector('.preStyle') || el.querySelector('.option-content') || el.querySelector('.stem');
                return preNode ? preNode.innerText.trim() : el.innerText.trim();
            });
            const answer = await getAnswer(qTitle, optionsText, qTypeText, 1);
            if (!answer) return false;

            for (const char of answer) {
                const idx = char.charCodeAt(0) - 65;
                if (idx < 0 || idx >= optionNodes.length) continue;
                const inputElement = optionNodes[idx].querySelector('.el-radio__original, .el-checkbox__original, input[type="radio"], input[type="checkbox"]') || optionNodes[idx];
                reliableClick(inputElement);
                await new Promise(r => setTimeout(r, 120));
            }
            return true;
        }

        while (autoMode) {
            const answered = await answerCurrentQuestion();

            if (pass >= 2 && answered) {
                const done = await trySubmitCheck(`pass-${pass}`);
                if (done) return;
            }

            const nextBtn = document.querySelector('.next-topic.next-t');
            if (nextBtn) {
                reliableClick(nextBtn);
                await new Promise(r => setTimeout(r, 650));
                continue;
            }

            const jumped = await gotoFirstQuestion();
            if (jumped) {
                pass++;
                log(`开始第 ${pass} 轮循环`, 'debug');
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            await new Promise(r => setTimeout(r, 1000));
        }
    }



    // 主页逻辑：自动悬停并点击"提升掌握度"按钮
    async function findAndScrollToIncompleteItem() {
        log("正在等待课程列表加载...");
        const foundItems = await waitForElement('.item-content', 15000);
        if (!foundItems) {
            log("未能找到知识点列表，可能当前页面不是课程主页或网络极慢。");
            return;
        }
        await new Promise(r => setTimeout(r, 1000)); // 给它一点时间渲染进度条
        
        const items = document.querySelectorAll('.item-content');
        log(`找到 ${items.length} 个知识点项`);
        
        let validItems = [];
        let index = 0;
        const noImproveCache = getNoImproveCache();

        for(let item of items) {
            const pctNode = item.querySelector('.el-progress__text span');
            let pct = 0;
            if(pctNode) {
                const parsed = parseInt(pctNode.innerText.trim(), 10);
                if(!isNaN(parsed)) pct = parsed;
            }
            
            const titleNode = item.querySelector('.item-title');
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
            sessionStorage.setItem('last_attempted_item', itemName);
            setCurrentChapterKey(itemName);
            
            targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise(r => setTimeout(r, 500));
            
            const titleNode = targetItem.querySelector('.item-title');
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
            await new Promise(r => setTimeout(r, 500));
        }

        if (btn) {
            const currentItemName = getCurrentLearnItemName();
            if (currentItemName) {
                sessionStorage.setItem('last_attempted_item', currentItemName);
            }
            const btnText = (btn.textContent || btn.innerText || '').trim();
            log(`找到可点击按钮: "${btnText}"，准备点击...`, 'debug');
            reliableClick(btn);
            return;
        }

        const currentItemName = getCurrentLearnItemName() || sessionStorage.getItem('last_attempted_item') || '';
        if (currentItemName) {
            addToNoImproveCache(currentItemName);
        } else {
            log('未能识别当前章节名，但已判定本页无去提升。');
        }
        goToCourseList('当前 learnPage 无「去提升」，回 singleCourse 重新找高优先级章节...');
    }

    async function processMasteryHistory() {
        log("进入历史掌握度页面，寻找「去提升」按钮...");
        await new Promise(r => setTimeout(r, 2000));
        const btn = document.querySelector('.improve-btn');
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
        await new Promise(r => setTimeout(r, 2000)); // 给点时间看成绩

        // 优先按URL规则直接构造解析页地址，避免按钮点击失效导致卡住
        const derivedPreviewUrl = buildExamPreviewUrlFromPointUrl();
        if (derivedPreviewUrl) {
            log('已根据 point 链接构造 examPreview 地址，准备直接跳转采集...', 'debug');
            window.location.href = derivedPreviewUrl;
            return;
        }

        const directPreviewUrl = findExamPreviewUrlFromPage();
        if (directPreviewUrl) {
            log('检测到解析页直达链接，准备直接跳转采集...', 'debug');
            window.location.href = directPreviewUrl;
            return;
        }

        const previewBtn = findClickableByText(['查看', '作答', '记录']) || findClickableByText(['查看', '解析']);
        if (previewBtn) {
            log('检测到可查看作答记录入口，准备采集题目与答案用于后续同章节增强。', 'debug');
            reliableClick(previewBtn);
            // 防止点击无效：等待跳转，超时后回课程主页避免卡死
            const startUrl = window.location.href;
            const timeout = Date.now() + 8000;
            while (Date.now() < timeout) {
                if (window.location.href !== startUrl) return;
                await new Promise(r => setTimeout(r, 400));
            }
            log('点击查看作答记录后未发生跳转，可能入口不可点击，回课程主页继续。', 'warn');
            goToCourseList('结算页采集入口点击无效，回 singleCourse 继续执行...');
            return;
        }

        const fallbackPreviewUrl = sessionStorage.getItem('last_exam_preview_url') || '';
        if (fallbackPreviewUrl) {
            log('当前页未找到解析入口，尝试使用历史解析链接进行采集...', 'warn');
            window.location.href = fallbackPreviewUrl;
            return;
        }

        goToCourseList('结算页处理完成，返回 singleCourse 继续按优先级找题...');
    }

    async function processExamPreviewPage() {
        const chapterKey = getCurrentChapterKey();
        if (chapterKey) setCurrentChapterKey(chapterKey);
        sessionStorage.setItem('last_exam_preview_url', window.location.href);
        log(`进入答题解析页，开始提取题目答案记录...${chapterKey ? ` (章节: ${chapterKey})` : ''}`, 'debug');
        await new Promise(r => setTimeout(r, 2000));

        const questionBlocks = document.querySelectorAll('.questionContent, .question-item, .topic-item, .question-wrapper, .preview-question-item');
        const extractedRecords = [];

        const normalizeLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        const cleanQuestion = (s) => normalizeLine(s).replace(/^\d+[、.．]\s*/, '');

        questionBlocks.forEach(block => {
            const qNode = block.querySelector('.quest-title .option-name .inner-box, .quest-title .option-name, .quest-title, .centent-pre pre.preStyle, .question-title, .topic-title, .stem, .title');
            const q = qNode ? cleanQuestion(qNode.textContent || qNode.innerText || '') : '';

            // 优先提取“参考答案”，避免把用户错误作答写入记忆库
            const referenceAnswerSpans = block.querySelectorAll('.analysis .answer-title span, .answer-title span');
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
                const answerTitleNode = block.querySelector('.analysis .answer-title, .answer-title');
                if (answerTitleNode) {
                    const titleText = normalizeLine(answerTitleNode.textContent || answerTitleNode.innerText || '');
                    const matched = titleText.match(/参考答案[:：]\s*(.+)$/);
                    if (matched && matched[1]) {
                        a = normalizeLine(matched[1]);
                    }
                }
            }

            if (!a) {
                const aNode = block.querySelector('.correct-answer, .right-answer, .analysis-answer, .answer-content, .answer, .answer-text');
                a = aNode ? normalizeLine(aNode.textContent || aNode.innerText || '') : '';
            }

            if (!a) {
                const checked = block.querySelectorAll('.is-checked, .checked, input:checked');
                if (checked.length > 0) {
                    const labels = [];
                    checked.forEach(el => {
                        const txt = (el.textContent || el.innerText || '').trim();
                        if (txt) labels.push(txt);
                    });
                    if (labels.length > 0) a = labels.join(' || ');
                }
            }

            const isErrorResult = !!block.querySelector('.question-result.error');
            if (isErrorResult && !block.querySelector('.analysis .answer-title, .answer-title')) {
                // 错题且无参考答案时，不记录用户答案，防止污染记忆库
                a = '';
            }

            if (q && a && chapterKey) {
                extractedRecords.push({ q, a });
            }
        });

        if (chapterKey && extractedRecords.length > 0) {
            const savedCount = replaceChapterQaRecords(chapterKey, extractedRecords);
            log(`已覆盖更新章节记忆库，共 ${savedCount} 条（旧记录已替换）。`, 'info');
        } else {
            log('未提取到有效题目答案记录（可能页面结构不同）。', 'warn');
        }

        goToCourseList('解析页采集完成，返回课程主页继续执行...');
    }

    function mainLoop() {
        if (!autoMode) return;
        const currentUrl = window.location.href;
        
        // 记录课程主列表URL
        if (currentUrl.includes('/singleCourse/')) {
            sessionStorage.setItem('course_list_url', currentUrl);
        }

        if (currentUrl.includes('/singleCourse/')) {
            findAndScrollToIncompleteItem().catch(err => {
                log(`singleCourse处理异常: ${err.message}`);
            });
        } else if (currentUrl.includes('/learnPage/')) {
            handleLearnPage().catch(err => {
                log(`learnPage处理异常: ${err.message}`);
                goToCourseList('learnPage异常，回课程主页继续执行...');
            });
        } else if (currentUrl.includes('/masteryHistory/')) {
            processMasteryHistory().catch(err => {
                log(`masteryHistory处理异常: ${err.message}`);
            });
        } else if (currentUrl.includes('/studentReviewTestOrExam/')) {
            processTestPage().catch(err => {
                log(`答题页处理异常: ${err.message}`);
            });
        } else if (currentUrl.includes('/point/')) {
            processPointPage().catch(err => {
                log(`结算页处理异常: ${err.message}`);
                goToCourseList('结算页异常，回课程主页继续执行...');
            });
        } else if (currentUrl.includes('/examPreview/')) {
            processExamPreviewPage().catch(err => {
                log(`解析页处理异常: ${err.message}`, 'error');
                goToCourseList('解析页异常，回课程主页继续执行...');
            });
        } else if (currentUrl.includes('/mySpace/')) {
            log("当前在 mySpace，请先手动进入某个课程的 singleCourse 页面。");
        } else {
            log("当前页面不在课程流程内，请手动进入 singleCourse 页面。");
        }
    }

    function toggleAutoMode(start) {
        autoMode = start;
        GM_setValue('autoMode_state', start);
        if (autoMode) {
            clearLogBuffer();
            // 启动后不清空永久缓存，只重置本轮状态
            sessionStorage.removeItem('last_attempted_item');
            
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
