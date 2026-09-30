let captureIntervalId = null;
let captureStream = null;
let apiKey = '';
let systemPrompt = '';
let manualText = '';
let intervalSec = 6;
let isCapturing = false;
let history = [];

const DEFAULT_PROMPT = "あなたはPCの操作を支援するプロフェッショナルなAIアシスタントです。\n画面のスクリーンショット（Blender, Unreal Engine, Photoshop等の専門ソフトも含む）を見て、ユーザーが現在何をしているかを深く理解し、適切な操作アドバイスや次のステップを提案してください。\n簡潔で分かりやすい日本語で回答してください。";

const video = document.getElementById('capture-video');
const canvas = document.getElementById('capture-canvas');
const chatContainer = document.getElementById('chat-container');
const toggleBtn = document.getElementById('capture-toggle-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const mainView = document.getElementById('main-view');
const settingsView = document.getElementById('settings-view');

chrome.storage.local.get(['apiKey', 'systemPrompt', 'manualText', 'intervalSec'], (result) => {
    apiKey = result.apiKey || '';
    systemPrompt = result.systemPrompt || DEFAULT_PROMPT;
    manualText = result.manualText || '';
    intervalSec = result.intervalSec || 6;
    
    document.getElementById('api-key-input').value = apiKey;
    document.getElementById('prompt-input').value = systemPrompt;
    document.getElementById('manual-input').value = manualText;
    document.getElementById('interval-input').value = intervalSec;
    document.getElementById('interval-display').textContent = intervalSec;
});

document.getElementById('toggle-settings-btn').addEventListener('click', () => {
    mainView.classList.remove('active');
    settingsView.classList.add('active');
});

document.getElementById('save-settings-btn').addEventListener('click', () => {
    apiKey = document.getElementById('api-key-input').value;
    systemPrompt = document.getElementById('prompt-input').value;
    manualText = document.getElementById('manual-input').value;
    
    chrome.storage.local.set({ apiKey, systemPrompt, manualText, intervalSec });
    
    settingsView.classList.remove('active');
    mainView.classList.add('active');
});

document.getElementById('interval-input').addEventListener('input', (e) => {
    intervalSec = e.target.value;
    document.getElementById('interval-display').textContent = intervalSec;
});

function addMessage(text, role = 'assistant', isError = false) {
    const div = document.createElement('div');
    div.className = `message ${role} ${isError ? 'error' : ''}`;
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerText = text;
    div.appendChild(content);
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

toggleBtn.addEventListener('click', () => {
    if (isCapturing) stopCapture();
    else startCapture();
});

async function startCapture() {
    if (!apiKey) {
        addMessage('設定からGemini APIキーを入力してください。', 'assistant', true);
        return;
    }
    try {
        // Service Worker（裏側）ではなく、サイドパネル自身から直接ダイアログを呼び出します
        chrome.desktopCapture.chooseDesktopMedia(["screen", "window"], async (streamId) => {
            if (!streamId) {
                addMessage('キャプチャがキャンセルされました。', 'assistant', true);
                return;
            }
            try {
                captureStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } }
                });
                video.srcObject = captureStream;
                isCapturing = true;
                
                toggleBtn.textContent = '⏹ キャプチャ停止';
                toggleBtn.classList.add('active');
                statusDot.className = 'dot active';
                statusText.textContent = '稼働中';
                addMessage('画面キャプチャを開始しました。AIが分析中です...', 'assistant');
                
                processFrame();
                captureIntervalId = setInterval(processFrame, intervalSec * 1000);
                
                captureStream.getVideoTracks()[0].onended = () => stopCapture();
            } catch (err) {
                addMessage('カメラ・画面アクセスエラー: ' + err.message, 'assistant', true);
            }
        });
    } catch (err) { 
        console.error(err); 
        addMessage('キャプチャ起動エラー: ' + err.message, 'assistant', true);
    }
}

function stopCapture() {
    if (captureIntervalId) clearInterval(captureIntervalId);
    if (captureStream) captureStream.getTracks().forEach(track => track.stop());
    
    isCapturing = false;
    toggleBtn.textContent = '▶ キャプチャ開始';
    toggleBtn.classList.remove('active');
    statusDot.className = 'dot stopped';
    statusText.textContent = '停止中';
    addMessage('キャプチャを停止しました。', 'assistant');
}

let isProcessing = false;

async function processFrame(userMessage = '') {
    if (isProcessing || !isCapturing) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    
    isProcessing = true;
    try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        const base64Data = dataUrl.split(',')[1];
        
        await analyzeWithGemini(base64Data, userMessage);
    } catch (err) {
        console.error(err);
    } finally {
        isProcessing = false;
    }
}

async function analyzeWithGemini(base64Image, userMessage) {
    if (!apiKey) {
        addMessage('設定からGemini APIキーを入力してください。', 'assistant', true);
        return;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    let instruction = userMessage || "画面の操作状況を分析してください。";
    let sysInstruction = systemPrompt + (manualText ? `\n\n--- 参照マニュアル ---\n${manualText}\n---` : '');

    const userParts = [{ text: instruction }];
    if (base64Image) {
        userParts.push({ inline_data: { mime_type: "image/jpeg", data: base64Image } });
    }

    const payload = {
        system_instruction: { parts: [{ text: sysInstruction }] },
        contents: [
            ...history,
            {
                role: "user",
                parts: userParts
            }
        ],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    };
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'API Error');
        }
        
        const data = await response.json();
        const resultText = data.candidates[0].content.parts[0].text;
        addMessage(resultText, 'assistant');
        
        history.push({ role: "user", parts: [{ text: instruction }] });
        history.push({ role: "model", parts: [{ text: resultText }] });
        if (history.length > 2) history = history.slice(-2);
        
    } catch (err) {
        console.error(err);
        addMessage('LLMエラー: ' + err.message, 'assistant', true);
    }
}

let attachedBase64 = null;
const fileInput = document.getElementById('file-input');

if (document.getElementById('attach-btn')) {
    document.getElementById('attach-btn').addEventListener('click', () => {
        fileInput.click();
    });
}

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                attachedBase64 = dataUrl.split(',')[1];
                addMessage('📎 画像が添付されました', 'user');
            };
            reader.readAsDataURL(file);
        }
    });
}

document.getElementById('send-btn').addEventListener('click', () => {
    const input = document.getElementById('user-input');
    const msg = input.value.trim();
    if (msg || attachedBase64) {
        if (msg) addMessage(msg, 'user');
        input.value = '';
        if (isCapturing) {
            processFrame(msg);
        } else {
            analyzeWithGemini(attachedBase64, msg);
            attachedBase64 = null;
            if (fileInput) fileInput.value = '';
        }
    }
});

document.getElementById('user-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('send-btn').click();
});
