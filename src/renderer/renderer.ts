// Live2D関数はグローバルに公開されている（live2d.tsから）
declare function initLive2D(): Promise<void>;
declare function setMouthOpen(value: number): void;
declare function blinkLive2D(): void;
declare function setEmotion(emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking'): void;
declare function setEmotionFromText(text: string): void;
declare function startLipSync(): void;
declare function stopLipSync(): void;

// DOM要素
const avatarContainer = document.getElementById('avatar-container') as HTMLDivElement;
const chatContainer = document.getElementById('chat-container') as HTMLDivElement;
const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const conversationListEl = document.getElementById('conversation-list') as HTMLUListElement;
const newConversationBtn = document.getElementById('new-conversation-btn') as HTMLButtonElement;

// 状態
let isStreaming = false;
let currentAssistantMessageEl: HTMLDivElement | null = null;

// ============================================================
// 会話一覧の描画
// ============================================================

async function renderConversationList(): Promise<void> {
    const conversations = await window.electronAPI.conversationList();
    const activeId = await window.electronAPI.conversationGetActive();

    conversationListEl.innerHTML = '';

    for (const conv of conversations) {
        const li = document.createElement('li');
        li.className = 'conversation-item' + (conv.id === activeId ? ' active' : '');
        li.dataset.id = conv.id;

        const date = new Date(conv.updatedAt).toLocaleDateString('ja-JP');

        li.innerHTML = `
            <span class="title">${escapeHtml(conv.title)}</span>
            <button class="delete-btn" data-id="${conv.id}">×</button>
            <div class="meta">${date} · ${conv.messageCount}件</div>
        `;

        li.addEventListener('click', async (e) => {
            if ((e.target as HTMLElement).classList.contains('delete-btn')) return;
            await loadConversation(conv.id);
        });

        conversationListEl.appendChild(li);
    }

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = (e.target as HTMLElement).dataset.id;
            if (id && confirm('この会話を削除しますか？')) {
                await window.electronAPI.conversationDelete(id);
                await renderConversationList();
                chatContainer.innerHTML = '';
            }
        });
    });
}

// ============================================================
// 音声対話
// ============================================================

const voiceBtn = document.getElementById('voice-btn') as HTMLButtonElement;
let isVoiceDialogueActive = false;

voiceBtn.addEventListener('click', async () => {
    const status = await window.electronAPI.dialogueStatus();

    if (!status.available) {
        alert('音声対話機能が利用できません。\nVOICEVOXとWhisperが正しく設定されているか確認してください。');
        return;
    }

    if (status.active) {
        await window.electronAPI.dialogueStop();
    } else {
        await window.electronAPI.dialogueStart();
    }
});

window.electronAPI.onDialogueState((data) => {
    updateVoiceButtonState(data.state);
});

window.electronAPI.onDialogueUserSpeech((data) => {
    appendMessage('user', data.text);
    scrollToBottom();
    currentAssistantMessageEl = appendMessage('assistant', '');
});

window.electronAPI.onDialogueAssistantResponse((data) => {
    if (currentAssistantMessageEl) {
        currentAssistantMessageEl.innerHTML = formatContent(data.text);
    }
    currentAssistantMessageEl = null;
    renderConversationList();

    // 応答テキストから感情を検出してアバターに反映
    if (typeof setEmotionFromText === 'function') {
        setEmotionFromText(data.text);
        setTimeout(() => {
            if (typeof setEmotion === 'function') {
                setEmotion('neutral');
            }
        }, 5000);
    }
});

window.electronAPI.onDialogueError((data) => {
    console.error('Dialogue error:', data.error);
    if (currentAssistantMessageEl) {
        currentAssistantMessageEl.innerHTML = `<span style="color: #e94560;">エラー: ${escapeHtml(data.error)}</span>`;
    }
    currentAssistantMessageEl = null;
});

function updateVoiceButtonState(state: string): void {
    voiceBtn.className = 'voice-btn';

    switch (state) {
        case 'listening':
            voiceBtn.classList.add('listening');
            voiceBtn.textContent = '👂';
            voiceBtn.title = '聴いています... (クリックで停止)';
            isVoiceDialogueActive = true;
            break;
        case 'recording':
            voiceBtn.classList.add('recording');
            voiceBtn.textContent = '🔴';
            voiceBtn.title = '録音中...';
            break;
        case 'transcribing':
            voiceBtn.classList.add('thinking');
            voiceBtn.textContent = '📝';
            voiceBtn.title = '認識中...';
            break;
        case 'thinking':
            voiceBtn.classList.add('thinking');
            voiceBtn.textContent = '🤔';
            voiceBtn.title = '考え中...';
            break;
        case 'speaking':
            voiceBtn.classList.add('speaking');
            voiceBtn.textContent = '🔊';
            voiceBtn.title = '話しています... (クリックで中断)';
            // リップシンク開始
            if (typeof startLipSync === 'function') {
                startLipSync();
            }
            break;
        default:
            voiceBtn.textContent = '🎤';
            voiceBtn.title = '音声入力';
            isVoiceDialogueActive = false;
            // リップシンク停止
            if (typeof stopLipSync === 'function') {
                stopLipSync();
            }
            break;
    }
    
    // speaking以外の状態に遷移したらリップシンク停止
    if (state !== 'speaking' && typeof stopLipSync === 'function') {
        stopLipSync();
    }
}
async function initializeVoiceDialogue(): Promise<void> {
    const maxRetries = 10;
    let retries = 0;

    const checkStatus = async () => {
        try {
            const status = await window.electronAPI.dialogueStatus();
            if (status.available) {
                voiceBtn.disabled = false;
                updateVoiceButtonState(status.state);
                return true;
            }
        } catch (e) {
            console.error('Status check failed:', e);
        }
        return false;
    };

    if (await checkStatus()) return;

    voiceBtn.disabled = true;
    voiceBtn.title = '音声対話機能を準備中...';

    const interval = setInterval(async () => {
        retries++;
        const available = await checkStatus();

        if (available) {
            clearInterval(interval);
        } else if (retries >= maxRetries) {
            clearInterval(interval);
            voiceBtn.disabled = true;
            voiceBtn.title = '音声対話機能が利用できません';
        }
    }, 1000);
}

// ============================================================
// 初期化
// ============================================================

async function initialize(): Promise<void> {
    setupStreamListeners();
    await renderConversationList();

    const activeId = await window.electronAPI.conversationGetActive();
    if (activeId) {
        await loadConversation(activeId);
    }

    await initializeVoiceDialogue();
    await initializeLive2D();
}

async function initializeLive2D(): Promise<void> {
    try {
        await initLive2D();
        console.log('[Renderer] Live2D initialized');
    } catch (error) {
        console.error('[Renderer] Live2D initialization failed:', error);
        avatarContainer.classList.add('hidden');
    }
}

// ============================================================
// 会話のロード
// ============================================================

async function loadConversation(id: string): Promise<void> {
    const conversation = await window.electronAPI.conversationLoad(id);
    if (!conversation) return;

    chatContainer.innerHTML = '';

    for (const msg of conversation.messages) {
        appendMessage(msg.role, msg.content);
    }

    await renderConversationList();
    scrollToBottom();
}

// ============================================================
// メッセージ表示
// ============================================================

function appendMessage(role: string, content: string): HTMLDivElement {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = formatContent(content);
    chatContainer.appendChild(div);
    return div;
}

function formatContent(content: string): string {
    return escapeHtml(content)
        .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom(): void {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ============================================================
// メッセージ送信
// ============================================================

async function sendMessage(): Promise<void> {
    const message = messageInput.value.trim();
    if (!message || isStreaming) return;

    isStreaming = true;
    sendBtn.disabled = true;
    messageInput.value = '';

    appendMessage('user', message);
    scrollToBottom();

    currentAssistantMessageEl = appendMessage('assistant', '');

    await window.electronAPI.sendMessageStream(message);
}

// ============================================================
// ストリーミングイベント
// ============================================================

function setupStreamListeners(): void {
    window.electronAPI.removeLLMListeners('llm-token');
    window.electronAPI.removeLLMListeners('llm-done');
    window.electronAPI.removeLLMListeners('llm-error');

    window.electronAPI.onLLMToken((token) => {
        if (currentAssistantMessageEl) {
            const current = currentAssistantMessageEl.textContent || '';
            currentAssistantMessageEl.innerHTML = formatContent(current + token);
            scrollToBottom();
        }
    });

    window.electronAPI.onLLMDone((fullText) => {
        if (currentAssistantMessageEl) {
            currentAssistantMessageEl.innerHTML = formatContent(fullText);
        }
        isStreaming = false;
        sendBtn.disabled = false;
        currentAssistantMessageEl = null;
        renderConversationList();

        // 応答テキストから感情を検出してアバターに反映
        if (typeof setEmotionFromText === 'function') {
            setEmotionFromText(fullText);
            setTimeout(() => {
                if (typeof setEmotion === 'function') {
                    setEmotion('neutral');
                }
            }, 5000);
        }
    });

    window.electronAPI.onLLMError((error) => {
        console.error('LLM Error:', error);
        if (currentAssistantMessageEl) {
            currentAssistantMessageEl.innerHTML = `<span style="color: #e94560;">エラー: ${escapeHtml(error)}</span>`;
        }
        isStreaming = false;
        sendBtn.disabled = false;
        currentAssistantMessageEl = null;
    });
}

// ============================================================
// イベントバインド
// ============================================================

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

newConversationBtn.addEventListener('click', async () => {
    await window.electronAPI.conversationCreate();
    chatContainer.innerHTML = '';
    await renderConversationList();
});

initialize();