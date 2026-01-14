// DOM要素
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

        // 会話選択
        li.addEventListener('click', async (e) => {
            if ((e.target as HTMLElement).classList.contains('delete-btn')) return;
            await loadConversation(conv.id);
        });

        conversationListEl.appendChild(li);
    }

    // 削除ボタンのイベント
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
    // 簡易的なコードブロック処理
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

    // ユーザーメッセージを表示
    appendMessage('user', message);
    scrollToBottom();

    // アシスタントメッセージ用の要素を準備
    currentAssistantMessageEl = appendMessage('assistant', '');

    // ストリーミング開始
    await window.electronAPI.sendMessageStream(message);
}

// ============================================================
// ストリーミングイベント
// ============================================================

function setupStreamListeners(): void {
    // 既存リスナーを削除
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
        renderConversationList();  // タイトル更新のため
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

// ============================================================
// 初期化
// ============================================================

async function initialize(): Promise<void> {
    setupStreamListeners();
    await renderConversationList();

    // アクティブな会話があればロード
    const activeId = await window.electronAPI.conversationGetActive();
    if (activeId) {
        await loadConversation(activeId);
    }
}

initialize();