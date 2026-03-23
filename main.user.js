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
        #ai-panel { position: absolute; top: 45px; right: 0; width: 300px; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; display: none; }
        #ai-panel.show { display: block; }
        #panel-toggle { position: absolute; top: 0; right: 0; width: 40px; height: 40px; background-color: #0d6efd; color: white; border: none; border-radius: 50%; cursor: pointer !important; display: flex; justify-content: center; align-items: center; font-size: 20px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); z-index: 10000; }
        #panel-header { padding: 15px; background-color: #0d6efd; color: white; border-top-left-radius: 8px; border-top-right-radius: 8px; font-size: 18px; font-weight: 500; cursor: move; }
        #panel-content { padding: 20px; display: flex; flex-direction: column; gap: 15px; }
        #start-button { padding: 10px 15px; background-color: #198754; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; transition: background-color 0.3s; }
        #start-button:hover { background-color: #157347; }
        #status-log { margin-top: 15px; padding: 10px; background-color: #f8f9fa; border-radius: 4px; height: 100px; overflow-y: auto; font-size: 12px; color: #555; border: 1px solid #e0e0e0; }
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
    function log(message) {
        console.log(`[AI脚本] ${message}`);
        const timestamp = new Date().toLocaleTimeString();
        statusLog.innerHTML += `<div>${timestamp}: ${message}</div>`;
        statusLog.scrollTop = statusLog.scrollHeight;
    }

    function reliableClick(element) {
        if (!element) { log("警告: 尝试点击一个不存在的元素。"); return; }
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: unsafeWindow });
        element.dispatchEvent(clickEvent);
    }

    function callAiApi(question, options, type) {
        return new Promise((resolve) => {
            const prompt = `你是一个专业的在线课程答题助手。请根据以下题目和选项，直接给出正确答案。规则：1. **${type === '多选题' ? '这是一个多选题，答案可能有多个。' : '这是一个' + type + '。'}** 2. **如果是选择题或判断题，直接返回代表正确选项的字母。** 3. **如果是填空题，直接返回填空内容。如果有多个空，必须使用 "||" 分隔各个空的答案。** 4. **不要包含任何其他解释、标点符号或文字。** - 例如：如果选择题答案是A，就返回 "A"。- 如果是填空题答案是“苹果”和“香蕉”，就返回 "苹果||香蕉"。---题目: ${question}---选项:${options.map((opt, index) => `${String.fromCharCode(65 + index)}. ${opt}`).join('\n')}---你的答案:`;
            const messages = [{ "role": "user", "content": prompt }];

            let url, headers, data;

            if (savedProvider === 'custom') {
                if (!savedApiUrl || !savedApiKey || !savedApiModel) {
                    log("错误：自定义AI接口的URL、Key或Model为空，请在面板中设置并保存。");
                    resolve(null);
                    return;
                }
                url = savedApiUrl;
                headers = { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${savedApiKey}`
                };
                data = JSON.stringify({ 
                    model: savedApiModel,
                    messages: messages,
                    temperature: 0.1
                });
                log(`正在请求AI回答 (${savedApiModel})...`);
            } else {
                url = "https://api.coren.xin/zhipu-free-proxy";
                headers = { "Content-Type": "application/json" };
                data = JSON.stringify({ messages: messages });
                log("正在请求AI回答 (免费模型 GLM-4.5-Flash)...");
            }

            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: headers,
                data: data,
                timeout: 15000,
                onload: function (response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const responseData = JSON.parse(response.responseText);
                            const content = responseData.choices?.[0]?.message?.content;

                            if (content !== null && content !== undefined) {
                                let answer = content.trim();
                                if (type.includes("填空")) {
                                    log(`AI 填空题回答: ${answer}`);
                                    resolve(answer);
                                    return;
                                }
                                
                                // 处理判断题的中文回复
                                let isTrueFalseText = false;
                                if (type.includes('判断')) {
                                    if (answer.includes('对') || answer.includes('正确') || answer.includes('T') || answer.includes('√')) {
                                        answer = 'A';
                                        isTrueFalseText = true;
                                    } else if (answer.includes('错') || answer.includes('错误') || answer.includes('F') || answer.includes('×')) {
                                        answer = 'B';
                                        isTrueFalseText = true;
                                    }
                                }
                                
                                if (!isTrueFalseText) {
                                    answer = answer.toUpperCase().replace(/[^A-Z]/g, '');
                                }
                                
                                log(`AI 回答: ${answer}`);
                                resolve(answer);

                            } else {
                                log(`API 返回错误: ${responseData.message || '内容为空'}`);
                                resolve(null);
                            }
                        } catch (e) {
                            log(`解析API响应失败: ${e.message}`);
                            resolve(null);
                        }
                    } else {
                        log(`API 请求失败: ${response.status} ${response.statusText}`);
                        resolve(null);
                    }
                },
                onerror: (error) => { log(`API 调用出错: ${error.statusText || '网络错误'}`); resolve(null); },
                ontimeout: () => { log(`API 请求超时 (15秒)。`); resolve(null); }
            });
        });
    }

    // --- 总的答案获取调度函数 ---
    async function getAnswer(question, options, type, retries = 3) {
        for (let i = 0; i < retries; i++) {
            const ans = await callAiApi(question, options, type);
            if (ans) return ans;
            log(`AI 第 ${i + 1} 次尝试失败，准备重试...`);
            await new Promise(r => setTimeout(r, 2000));
        }
        return null;
    }


    // --- 6. 页面处理逻辑 ---
        async function processTestPage() {
        log("进入答题页面，等待加载...");
        await new Promise(r => setTimeout(r, 3000));
        
        let loopLimit = 50;
        let loopCount = 0;
        
        while(autoMode && loopCount < loopLimit) {
            loopCount++;
            await new Promise(r => setTimeout(r, 1500));
            
            // 提取当前题目内容
            const qContent = document.querySelector('.questionContent');
            if(!qContent) {
                log("未找到题目区域，可能已结束或未加载...");
                break;
            }
            
            const qTitleNode = qContent.querySelector('.centent-pre pre.preStyle');
            const qTitle = qTitleNode ? qTitleNode.innerText.trim() : "";
            
            const qTypeNode = qContent.querySelector('.letterSortNum');
            const qTypeText = qTypeNode ? qTypeNode.innerText.trim() : "未知题型";
            
            if(!qTitle) {
                log("未找到题目文本...");
                break;
            }
            
            log(`处理题目 (${qTypeText}): ${qTitle}`);
            
            // 判断是否为填空题
            if(qTypeText.includes("填空")) {
                const inputs = qContent.querySelectorAll('.input-ques .fillAnswer input.el-input__inner, .input-ques .fillAnswer textarea.el-textarea__inner');
                if(inputs && inputs.length > 0) {
                    log(`检测到填空题，共 ${inputs.length} 个空，开始获取答案...`);
                    // 填空题直接使用AI或者特定的提示词
                    const ansStr = await getAnswer(qTitle + " (请按顺序给出填空答案，如果有多个空，请用'||'分隔，不要输出其他废话)", [], "填空题");
                    
                    if(ansStr) {
                        const ansList = ansStr.split('||').map(s => s.trim());
                        for(let i=0; i < inputs.length; i++) {
                            if(ansList[i]) {
                                log(`填入第 ${i+1} 空: ${ansList[i]}`);
                                const inputElement = inputs[i];
                                
                                // 根据标签类型获取对应的原生setter
                                const proto = inputElement.tagName.toUpperCase() === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(proto, "value").set;
                                
                                inputElement.focus();
                                inputElement.dispatchEvent(new Event('focus', { bubbles: true }));
                                
                                // 调用原生setter绕过Vue劫持
                                if (nativeInputValueSetter) {
                                    nativeInputValueSetter.call(inputElement, ansList[i]);
                                } else {
                                    inputElement.value = ansList[i];
                                }

                                // 触发一连串的事件，确保Vue/Element-UI能够捕获并更新v-model
                                inputElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                                inputElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                                inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
                                inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
                                inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
                                inputElement.blur();
                            }
                        }
                    } else {
                        log("未获取到填空题答案。");
                    }
                }
            } else {
                // 选择题 (单选/多选/判断)
                const optionNodes = qContent.querySelectorAll('.el-radio, .el-checkbox, .option-item, .topic-option-item, ul.radio-view li');
                if(optionNodes && optionNodes.length > 0) {
                    const optionsText = Array.from(optionNodes).map(el => {
                        const preNode = el.querySelector('.preStyle') || el.querySelector('.option-content') || el.querySelector('.stem');
                        return preNode ? preNode.innerText.trim() : el.innerText.trim();
                    });
                    
                    const answer = await getAnswer(qTitle, optionsText, qTypeText);
                    if (answer) {
                        log(`尝试选择答案: ${answer}`);
                        for (let char of answer) {
                            const optionIndex = char.charCodeAt(0) - 65;
                            if (optionIndex >= 0 && optionIndex < optionNodes.length) {
                                const inputElement = optionNodes[optionIndex].querySelector('.el-radio__original, .el-checkbox__original, input[type="radio"], input[type="checkbox"]') || optionNodes[optionIndex];
                                if (inputElement) { 
                                    reliableClick(inputElement); 
                                } else { 
                                    log(`错误：找不到选项 ${char} 的点击元素。`); 
                                }
                                await new Promise(r => setTimeout(r, 200));
                            }
                        }
                    } else {
                        log("未找到选择题答案。");
                    }
                } else {
                    log("既不是填空题也没找到选择项，跳过...");
                }
            }
            
            // 翻页
            await new Promise(r => setTimeout(r, 1500));
            const nextBtn = document.querySelector('.next-topic.next-t');
            if(nextBtn) {
                log("点击下一题...");
                reliableClick(nextBtn);
                await new Promise(r => setTimeout(r, 1000));
            } else {
                log("没有下一题按钮，已经是最后一题。");
                break;
            }
        }
        
        if (autoMode) {
            log("所有题目回答完毕，准备提交...");
            await new Promise(r => setTimeout(r, 2000));
            const submitButton = document.querySelector('.reviewDone');
            if(submitButton) {
                reliableClick(submitButton);
                log("已点击提交作业按钮。");
                // 处理弹窗
                await new Promise(r => setTimeout(r, 1000));
                
                let hasUnanswered = false;
                const allDialogs = document.querySelectorAll('.el-dialog__wrapper, .el-message-box__wrapper, .van-dialog');
                for(let dialog of allDialogs) {
                    if(dialog.style.display !== 'none') {
                        const dialogText = dialog.innerText || "";
                        if (dialogText.includes("未作答") || dialogText.includes("未完成") || dialogText.includes("还有") || dialogText.includes("空白")) {
                            log("检测到未作答提示，取消提交，准备重新检查未做题目...");
                            hasUnanswered = true;
                            const cancelBtn = dialog.querySelector('.cancel.button') || dialog.querySelector('.el-button--default') || dialog.querySelector('.van-dialog__cancel');
                            if (cancelBtn) reliableClick(cancelBtn);
                        } else {
                            const btn = dialog.querySelector('.comfirm.button') || dialog.querySelector('.el-button--primary') || dialog.querySelector('.van-dialog__confirm');
                            if(btn) {
                                reliableClick(btn);
                                log("确认提交！");
                            }
                        }
                    }
                }
                
                if (hasUnanswered) {
                    log("正在寻找未作答的题目...");
                    await new Promise(r => setTimeout(r, 1500));
                    // 尝试在答题卡中寻找未作答的元素
                    const unAnsweredItems = document.querySelectorAll('.answerCard .answer-item:not(.is-answered), .topic-list .topic-item:not(.done), .card-list li:not(.active)');
                    if (unAnsweredItems.length > 0) {
                        log(`找到 ${unAnsweredItems.length} 个未作答题目，跳转到第一个...`);
                        reliableClick(unAnsweredItems[0]);
                    } else {
                        log("未能定位到未作答题目的具体位置，尝试点击上一题按钮回退...");
                        const prevBtn = document.querySelector('.prev-topic.prev-t');
                        if (prevBtn) reliableClick(prevBtn);
                    }
                    // 重新启动答题流程
                    setTimeout(processTestPage, 2000);
                    return; // 阻止本次继续提交
                }
            }
        }
    }



    // 主页逻辑：自动悬停并点击"提升掌握度"按钮
    async function findAndScrollToIncompleteItem() {
        await new Promise(r => setTimeout(r, 2000));
        
        const items = document.querySelectorAll('.item-content');
        log(`找到 ${items.length} 个知识点项`);
        
        let validItems = [];
        let index = 0;
        let failedItems = JSON.parse(sessionStorage.getItem('failed_items') || '[]');

        for(let item of items) {
            const pctNode = item.querySelector('.el-progress__text span');
            let pct = 0;
            if(pctNode) {
                const parsed = parseInt(pctNode.innerText.trim(), 10);
                if(!isNaN(parsed)) pct = parsed;
            }
            
            const titleNode = item.querySelector('.item-title');
            const itemName = titleNode ? titleNode.innerText.trim() : ('未知知识点' + index);

            if(pct < 100 && !failedItems.includes(itemName)) {
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
            log("当前页面没有未满100%的有效知识点，或剩余知识点暂无题目，任务结束。");
            toggleAutoMode(false);
        }
    }

    async function launchMasteryExam(retryCount = 0) {
        await new Promise(r => setTimeout(r, 2000));
        const btn = document.querySelector('.simplified-mastery__action');
        if(btn) {
            log("找到「去提升」按钮，点击进入答题...");
            reliableClick(btn);

            // 检查是否跳转成功，或是否弹出了“暂无题目”等错误提示
            let checkCount = 0;
            const checkNav = setInterval(() => {
                checkCount++;
                
                // 检查 Element UI 消息提示
                const messages = document.querySelectorAll('.el-message__content');
                let hasErrorMsg = false;
                for(let msg of messages) {
                    if(msg.innerText.includes('题') || msg.innerText.includes('无') || msg.innerText.includes('空')) {
                        hasErrorMsg = true;
                        break;
                    }
                }
                
                if (!window.location.href.includes('/learnPage/')) {
                    clearInterval(checkNav); // 跳转成功
                } else if (checkCount >= 5 || hasErrorMsg) { 
                    clearInterval(checkNav);
                    log("点击去提升后未跳转或提示无题目，将跳过此章节...");
                    
                    // 加入黑名单防止无限循环
                    let failedItems = JSON.parse(sessionStorage.getItem('failed_items') || '[]');
                    let lastItem = sessionStorage.getItem('last_attempted_item');
                    if (lastItem && !failedItems.includes(lastItem)) {
                        failedItems.push(lastItem);
                        sessionStorage.setItem('failed_items', JSON.stringify(failedItems));
                    }
                    
                    // 尝试返回
                    sessionStorage.setItem('need_refresh', 'true');
                    const courseUrl = sessionStorage.getItem('course_list_url');
                    if (courseUrl) {
                        window.location.href = courseUrl;
                    } else {
                        window.history.back();
                    }
                }
            }, 1000);

        } else {
            if (retryCount < 3) {
                log(`未找到「去提升」按钮，可能页面未加载完毕，等待重试...(${retryCount + 1}/3)`);
                if(autoMode) setTimeout(() => launchMasteryExam(retryCount + 1), 2000);
            } else {
                log("确认当前页面没有「去提升」按钮（可能是暂无题目或已满分），将跳过此章节...");
                
                // 加入黑名单防止无限循环
                let failedItems = JSON.parse(sessionStorage.getItem('failed_items') || '[]');
                let lastItem = sessionStorage.getItem('last_attempted_item');
                if (lastItem && !failedItems.includes(lastItem)) {
                    failedItems.push(lastItem);
                    sessionStorage.setItem('failed_items', JSON.stringify(failedItems));
                }
                
                // 标记需要刷新并直接跳回主列表
                sessionStorage.setItem('need_refresh', 'true');
                const courseUrl = sessionStorage.getItem('course_list_url');
                if (courseUrl) {
                    window.location.href = courseUrl;
                } else {
                    window.history.back();
                }
            }
        }
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
        log("进入知识点结算页面，准备返回...");
        await new Promise(r => setTimeout(r, 3000)); // 给点时间看成绩
        const backBtn = document.querySelector('.backup-icon') || document.querySelector('.backup');
        if(backBtn) {
            log("点击返回按钮，准备开启下一轮...");
            sessionStorage.setItem('need_refresh', 'true');
            reliableClick(backBtn);
        } else {
            log("未找到返回按钮，尝试直接返回...");
            sessionStorage.setItem('need_refresh', 'true');
            window.history.back();
        }
    }

    function mainLoop() {
        if (!autoMode) return;
        const currentUrl = window.location.href;
        
        // 记录课程主列表的URL，方便后面直接跳回来
        if (currentUrl.includes('/singleCourse/')) {
            sessionStorage.setItem('course_list_url', currentUrl);
        }

        // --- 核心修复：处理答题结束后的返回与刷新逻辑 ---
        if (sessionStorage.getItem('need_refresh') === 'true') {
            if (currentUrl.includes('/learnPage/')) {
                // 1. 从分数结算页退回时，落在“章节学习页 (/learnPage/)”
                // 此时直接强制跳回主列表的URL，避免触发浏览器的奇怪历史记录前进后退问题导致死循环
                log("已退回到章节页，准备直接跳转回课程主列表并刷新...");
                const courseUrl = sessionStorage.getItem('course_list_url');
                if (courseUrl) {
                    window.location.href = courseUrl; // 直接导航过去
                } else {
                    window.history.back(); // 兜底
                }
                return; // 中断本次执行，等待回到主列表
            } else if (currentUrl.includes('/singleCourse/')) {
                // 2. 成功回到“课程主列表 (/singleCourse/)”后，立即强制刷新
                sessionStorage.removeItem('need_refresh');
                log("已回到主列表，正在强制刷新页面以获取最新掌握度...");
                location.reload();
                return; // 刷新后脚本会重新加载
            }
        }

        if (currentUrl.includes('/singleCourse/')) {
            findAndScrollToIncompleteItem();
        } else if (currentUrl.includes('/learnPage/')) {
            launchMasteryExam();
        } else if (currentUrl.includes('/masteryHistory/')) {
            processMasteryHistory();
        } else if (currentUrl.includes('/studentReviewTestOrExam/')) {
            processTestPage();
        } else if (currentUrl.includes('/point/')) {
            processPointPage();
        }
    }

    function toggleAutoMode(start) {
        autoMode = start;
        GM_setValue('autoMode_state', start);
        if (autoMode) {
            startButton.textContent = '停止自动答题';
            startButton.style.backgroundColor = '#dc3545';
            log('自动答题已开始！');
            mainLoop();
        } else {
            startButton.textContent = '开始自动答题';
            startButton.style.backgroundColor = '#198754';
            log('自动答题已停止。');
        }
    }

    // --- 6. 启动脚本和监听器 ---
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            log(`URL 变动: ${url}`);
            if (autoMode) setTimeout(mainLoop, 2000);
        }
    }).observe(document, { subtree: true, childList: true });

    window.addEventListener('load', () => {
        log("AI答题脚本已加载。点击上方按钮开始自动答题。");
        
        // 恢复自动答题状态
        if (autoMode) {
            startButton.textContent = '停止自动答题';
            startButton.style.backgroundColor = '#dc3545';
            log('检测到自动答题状态开启，继续执行...');
            setTimeout(mainLoop, 2000);
        }
    }, false);

})();