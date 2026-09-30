chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "requestDesktopCapture") {
    // サイドパネルからのリクエストの場合、sender.tabがundefinedになるため、現在アクティブなタブを探してダイアログを紐付けます
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        sendResponse({ error: "アクティブなタブが見つかりません。何かWebページを開いた状態でボタンを押してください。" });
        return;
      }
      
      const currentTab = tabs[0];
      
      try {
        chrome.desktopCapture.chooseDesktopMedia(
          ["screen", "window"],
          currentTab,
          (streamId) => {
            if (!streamId) {
              sendResponse({ error: "User canceled or capture failed" });
              return;
            }
            sendResponse({ streamId: streamId });
          }
        );
      } catch (e) {
        sendResponse({ error: e.toString() });
      }
    });
    
    return true; // 非同期レスポンスのために必要
  }
});
