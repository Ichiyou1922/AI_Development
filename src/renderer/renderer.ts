// ProviderPreference はグローバルな型定義で提供される

type ProviderPreference = 'local-first' | 'api-first' | 'local-only' | 'api-only';

const messagesContainer = document.getElementById('messages') as HTMLDivElement;
const userInput = document.getElementById('user-input') as HTMLInputElement;
const sendButton = document.getElementById('send-button') as HTMLButtonElement;
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const clearButton = document.getElementById('clear-button') as HTMLButtonElement;

let currentAssistantMessage: HTMLDivElement | null = null;
let currentContentDiv: HTMLDivElement | null = null;

function addMessage(role: 'user' | 'assistant', text: string, provider?: string): HTMLDivElement {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  const roleLabel = document.createElement('div');
  roleLabel.className = 'role';
  if (role === 'assistant' && provider) {
    roleLabel.textContent = `AI (${provider})`;
  } else {
    roleLabel.textContent = role === 'user' ? 'You' : 'AI';
  }
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';
  contentDiv.textContent = text;
  
  messageDiv.appendChild(roleLabel);
  messageDiv.appendChild(contentDiv);
  messagesContainer.appendChild(messageDiv);
  
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  return messageDiv;
}

function createEmptyAssistantMessage(): void {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const roleLabel = document.createElement('div');
    roleLabel.className = 'role';
    roleLabel.textContent = 'AI';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    contentDiv.textContent = '';

    messageDiv.appendChild(roleLabel);
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);

    // 参照を保持
    currentAssistantMessage = messageDiv;
    currentContentDiv = contentDiv;

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
 }

 // token追記
 function appendToken(token: string): void {
    if (currentContentDiv) {
        currentContentDiv.textContent += token;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
 }

 // ストリーミング終了
 function finalizeStream(): void {
    currentAssistantMessage = null;
    currentContentDiv = null;
 }

 async function sendMessageStream(): Promise<void> {
    const message = userInput.value.trim();
    if (!message) return;

    userInput.value = '';
    sendButton.disabled = true;
    addMessage('user', message);

    // 空のアシスタントメッセージ
    createEmptyAssistantMessage();

    // リスナー登録
    // 既存のリスナーが残っているとトークンが重複するため、先に解除する
    //window.electronAPI.removeAllListeners();
    window.electronAPI.onLLMToken((token) => {
      appendToken(token);
    });

    window.electronAPI.onLLMDone((_fullText) => {
        finalizeStream();
        window.electronAPI.removeAllListeners();
        sendButton.disabled = false;
        userInput.focus();
    });

    window.electronAPI.onLLMError((error) => {
        if (currentContentDiv) {
            currentContentDiv.textContent = `エラー: ${error}`;
        }
        finalizeStream();
        window.electronAPI.removeAllListeners();
        sendButton.disabled = false;
        userInput.focus();
    });

    // ストリーミング開始
    await window.electronAPI.sendMessageStream(message);
 }

 sendButton.addEventListener('click', sendMessageStream);

 userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessageStream();
    }
 });

async function initializeUI(): Promise<void> {
  // 現在のプロバイダー設定を取得
  const preference = await window.electronAPI.getProviderPreference();
  providerSelect.value = preference;
}

providerSelect.addEventListener('change', async () => {
  const preference = providerSelect.value as ProviderPreference;
  await window.electronAPI.setProviderPreference(preference);
});

clearButton.addEventListener('click', async () => {
  await window.electronAPI.clearHistory();
  messagesContainer.innerHTML = '';
});

// 初期化
initializeUI();
userInput.focus();