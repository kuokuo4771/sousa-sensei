const steps = [
  {
    title: "新しいスライドを追加します",
    instruction: "ホームタブの「新しいスライド」ボタンをクリックしてください。",
    success: "2枚目のスライドが追加されます。",
    actionText: "「新しいスライド」を1回クリック",
    target: "新しいスライドボタン",
    operation: "1回クリック",
    result: "スライドを追加する",
    action: "add-slide"
  },
  {
    title: "タイトルを入力します",
    instruction: "スライド上部の「タイトルを入力」と書かれた枠をクリックし、文字を入力してください。",
    success: "タイトルが入力状態になります。",
    actionText: "タイトル枠をクリック",
    target: "タイトル枠",
    operation: "1回クリック",
    result: "タイトルの入力状態にする",
    action: "input-title"
  },
  {
    title: "図形を挿入します",
    instruction: "挿入タブに切り替え、「図形」ボタンをクリックしてください。",
    success: "スライドに四角形が配置されます。",
    actionText: "挿入タブから図形を追加",
    target: "図形ボタン",
    operation: "1回クリック",
    result: "四角形をスライドに配置する",
    action: "insert-shape"
  }
];

const state = {
  mode: "guide",
  step: 0,
  running: false,
  analyzing: false,
  stopped: false,
  completed: false,
  analysisTimer: null,
  toastTimer: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const startView = $("#startView");
const sessionView = $("#sessionView");
const guideActions = $("#guideActions");
const instructionState = $("#instructionState");
const analysisState = $("#analysisState");
const completedState = $("#completedState");
const stoppedState = $("#stoppedState");
const captureStatus = $("#captureStatus");
const autoAction = $("#autoAction");
const tabHome = $("#tabHome");
const tabInsert = $("#tabInsert");
const homeTools = $("#homeTools");
const insertTools = $("#insertTools");
const newSlideBtn = $("#newSlideBtn");
const shapeBtn = $("#shapeBtn");
const thumbSlide2 = $("#thumbSlide2");
const titlePlaceholder = $("#titlePlaceholder");
const addedShape = $("#addedShape");


function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function setModal(id, visible) {
  const modal = $(id);
  modal.hidden = !visible;
  if (visible) {
    const focusTarget = modal.querySelector("button, input");
    if (focusTarget) focusTarget.focus();
  }
}

function renderStep() {
  if (!state.running) return;

  instructionState.hidden = state.completed || state.stopped || state.analyzing;
  analysisState.hidden = !state.analyzing;
  completedState.hidden = !state.completed;
  stoppedState.hidden = !state.stopped;
  guideActions.hidden = state.completed || state.stopped;

  if (state.completed || state.stopped || state.analyzing) return;

  const step = steps[state.step];
  $("#stepCounter").textContent = `手順 ${state.step + 1} / ${steps.length}`;
  $("#confidenceText").textContent = `認識 ${[94, 97, 91, 89, 93][state.step]}%`;
  $("#progressFill").style.width = `${((state.step + 1) / steps.length) * 100}%`;
  $("#stepTitle").textContent = step.title;
  $("#stepInstruction").textContent = step.instruction;
  $("#successCondition").textContent = step.success;
  $("#autoActionText").textContent = step.actionText;
  autoAction.hidden = state.mode !== "auto";
  $("#backButton").disabled = state.step === 0;
}

function analyzeThenRender(message = "変更を確認しました") {
  clearTimeout(state.analysisTimer);
  state.analyzing = true;
  renderStep();
  state.analysisTimer = setTimeout(() => {
    state.analyzing = false;
    renderStep();
    showToast(message);
  }, 820);
}

function startSession() {
  state.running = true;
  state.step = 0;
  state.completed = false;
  state.stopped = false;
  startView.hidden = true;
  sessionView.hidden = false;
  guideActions.hidden = false;
  captureStatus.classList.add("active");
  captureStatus.innerHTML = "<i></i> 監視中";
  analyzeThenRender("PowerPointの画面を認識しました");
}

function nextStep(message) {
  if (state.step >= steps.length - 1) {
    state.completed = true;
    state.analyzing = false;
    captureStatus.innerHTML = "<i></i> 完了";
    renderStep();
    return;
  }
  state.step += 1;
  analyzeThenRender(message);
}

function previousStep() {
  if (state.step === 0) return;
  state.step -= 1;
  analyzeThenRender("前の手順へ戻りました");
}

function resetPowerPoint() {
  thumbSlide2.hidden = true;
  titlePlaceholder.textContent = "タイトルを入力";
  titlePlaceholder.classList.remove("active");
  addedShape.hidden = true;
  tabHome.classList.add("active");
  tabInsert.classList.remove("active");
  homeTools.hidden = false;
  insertTools.hidden = true;
}

function restartSession() {
  resetPowerPoint();
  state.step = 0;
  state.completed = false;
  state.stopped = false;
  captureStatus.innerHTML = "<i></i> 監視中";
  analyzeThenRender("テスト画面を初期状態へ戻しました");
}

function performAction(action) {
  switch (action) {
    case "add-slide":
      thumbSlide2.hidden = false;
      break;
    case "input-title":
      titlePlaceholder.textContent = "新しいプレゼンテーション";
      titlePlaceholder.classList.add("active");
      break;
    case "insert-shape":
      tabInsert.classList.add("active");
      tabHome.classList.remove("active");
      homeTools.hidden = true;
      insertTools.hidden = false;
      addedShape.hidden = false;
      break;
  }
}

$("#startButton").addEventListener("click", startSession);
$("#nextButton").addEventListener("click", () => nextStep("「次へ」で進みました"));
$("#backButton").addEventListener("click", previousStep);
$("#restartButton").addEventListener("click", restartSession);

$("#stopButton").addEventListener("click", () => {
  state.stopped = true;
  state.analyzing = false;
  clearTimeout(state.analysisTimer);
  captureStatus.classList.remove("active");
  captureStatus.innerHTML = "<i></i> 停止中";
  renderStep();
});

$("#resumeButton").addEventListener("click", () => {
  state.stopped = false;
  captureStatus.classList.add("active");
  captureStatus.innerHTML = "<i></i> 監視中";
  analyzeThenRender("案内を再開しました");
});

$$(".mode-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    $$(".mode-button").forEach((item) => item.classList.toggle("active", item === button));
    renderStep();
    showToast(state.mode === "auto" ? "確認付き自動実行に切り替えました" : "案内モードに切り替えました");
  });
});

tabHome.addEventListener("click", () => {
  tabHome.classList.add("active");
  tabInsert.classList.remove("active");
  homeTools.hidden = false;
  insertTools.hidden = true;
});

tabInsert.addEventListener("click", () => {
  tabInsert.classList.add("active");
  tabHome.classList.remove("active");
  homeTools.hidden = true;
  insertTools.hidden = false;
});

newSlideBtn.addEventListener("click", () => {
  performAction("add-slide");
  completeManualStep(0, "スライドの追加を確認しました");
});

titlePlaceholder.addEventListener("click", () => {
  performAction("input-title");
  completeManualStep(1, "タイトルの入力を確認しました");
});

shapeBtn.addEventListener("click", () => {
  performAction("insert-shape");
  completeManualStep(2, "図形の挿入を確認しました");
});

$("#settingsButton").addEventListener("click", () => setModal("#settingsModal", true));
$$(".modal-close").forEach((button) => {
  button.addEventListener("click", () => setModal("#settingsModal", false));
});

$$(".settings-tab").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".settings-tab").forEach((item) => item.classList.toggle("active", item === button));
    $$(".setting-row").forEach((row) => {
      row.hidden = row.dataset.category !== button.dataset.tab;
    });
  });
});

$("#executeButton").addEventListener("click", () => {
  const step = steps[state.step];
  $("#confirmTarget").textContent = step.target;
  $("#confirmOperation").textContent = step.operation;
  $("#confirmResult").textContent = step.result;
  setModal("#confirmModal", true);
});

$("#cancelExecution").addEventListener("click", () => setModal("#confirmModal", false));
$("#confirmExecution").addEventListener("click", () => {
  const action = steps[state.step].action;
  setModal("#confirmModal", false);
  performAction(action);
  nextStep("自動操作後の画面変化を確認しました");
});

$("#unsureButton").addEventListener("click", () => setModal("#unsureModal", true));
$(".unsure-close").addEventListener("click", () => setModal("#unsureModal", false));
$("#safeGuideButton").addEventListener("click", () => {
  setModal("#unsureModal", false);
  renderStep();
  showToast("現在の手順をもう一度表示しました");
});
$("#reanalyzeButton").addEventListener("click", () => {
  setModal("#unsureModal", false);
  analyzeThenRender("画面を再確認しました");
});
$("#previousStepButton").addEventListener("click", () => {
  setModal("#unsureModal", false);
  previousStep();
});

$$(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop && backdrop.id !== "confirmModal") {
      backdrop.hidden = true;
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const openModal = $$(".modal-backdrop").find((modal) => !modal.hidden);
    if (openModal && openModal.id !== "confirmModal") {
      openModal.hidden = true;
      return;
    }
    if (state.running && !state.completed && !state.stopped) {
      $("#stopButton").click();
    }
  }
});





resetPowerPoint();
