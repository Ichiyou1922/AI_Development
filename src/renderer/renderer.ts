// ProviderPreference はグローバルな型定義で提供される

const messagesContainer = document.getElementById('messages') as HTMLDivElement;
const userInput = document.getElementById('user-input') as HTMLInputElement;
const sendButton = document.getElementById('send-button') as HTMLButtonElement;
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const clearButton = document.getElementById('clear-button') as HTMLButtonElement;

function addMessage(role: 'user' | 'assistant', text: string, provider?: string): void {
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
}

async function sendMessage(): Promise<void> {
  const message = userInput.value.trim();
  if (!message) return;
  
  userInput.value = '';
  sendButton.disabled = true;
  addMessage('user', message);
  
  try {
    const response = await window.electronAPI.sendMessage(message);
    
    if (response.success && response.text) {
      addMessage('assistant', response.text, response.provider);
    } else {
      addMessage('assistant', `エラー: ${response.error}`);
    }
  } catch (error) {
    addMessage('assistant', `通信エラー: ${error}`);
  } finally {
    sendButton.disabled = false;
    userInput.focus();
  }
}

async function initializeUI(): Promise<void> {
  // 現在のプロバイダー設定を取得
  const preference = await window.electronAPI.getProviderPreference();
  providerSelect.value = preference;
}

// イベントリスナー
sendButton.addEventListener('click', sendMessage);

userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

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