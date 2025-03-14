require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.0/min/vs",
  },
});
require(["vs/editor/editor.main"], function () {
  const editorView = document.querySelector(".editor-view");
  const userEditor = monaco.editor.create(
    document.getElementById("user-editor"),
    {
      value: "// Type your code here\n",
      language: "javascript",
      theme: "vs-dark",
    }
  );

  const aiEditor = monaco.editor.create(document.getElementById("ai-editor"), {
    value: "// AI suggestions will appear here\n",
    language: "javascript",
    theme: "vs-dark",
    readOnly: true,
  });

  const previewFrame = document.getElementById("preview-frame");
  const previewSection = document.querySelector(".preview-section");
  const previewBtn = document.getElementById("previewBtn");
  const ws = new WebSocket("ws://localhost:3000");
  const errorDisplay = document.getElementById("error-display");
  const sensei = document.getElementById("sensei");
  const featureSelect = document.getElementById("feature-select");
  const subFeatureSelect = document.getElementById("sub-feature-select");
  const comeAndCodeBtn = document.getElementById("come-and-code");
  const collabModal = document.getElementById("collab-modal");
  const closeCollabModal = document.getElementById("close-collab-modal");
  const startCollabBtn = document.getElementById("start-collab");
  const joinCollabBtn = document.getElementById("join-collab");
  const sessionIdInput = document.getElementById("session-id");
  const sessionInfo = document.getElementById("session-info");
  const moodAudio = document.getElementById("mood-audio");
  const copyCodeBtn = document.getElementById("copy-code");
  const promptTextarea = document.getElementById("prompt");
  const voiceInputBtn = document.getElementById("voiceInput");
  const screenShareBtn = document.getElementById("screenShare");
  let timeline = [];
  let moodEnabled = false;
  let currentModel = "gemini-1.5-flash";
  let selectedFeature = "aiHelp"; // Default feature

  // Ensure editor view is visible immediately
  editorView.style.display = "flex";

  // Preview Button Functionality
  previewBtn.addEventListener("click", () => {
    const code = aiEditor.getValue();
    if (code && code !== "// AI suggestions will appear here") {
      const firstLine = code.trim().split("\n")[0].toLowerCase();
      if (firstLine.includes("<!doctype html") || firstLine.includes("<html")) {
        // HTML preview in new tab
        const htmlWin = window.open("", "_blank");
        htmlWin.document.write(`
          <!DOCTYPE html>
          <html>
            <head><title>Preview</title></head>
            <body>${code}</body>
          </html>
        `);
        htmlWin.document.close();
      } else if (firstLine.includes("<style") || firstLine.includes("css")) {
        // CSS preview in new tab
        const cssWin = window.open("", "_blank");
        cssWin.document.write(`
          <!DOCTYPE html>
          <html>
            <head><title>CSS Preview</title><style>${code}</style></head>
            <body><div style="margin: 20px;">CSS applied to this div.</div></body>
          </html>
        `);
        cssWin.document.close();
      } else if (
        firstLine.includes("<script") ||
        firstLine.includes("javascript") ||
        firstLine.includes("function")
      ) {
        // JavaScript preview in new tab
        const jsWin = window.open("", "_blank");
        jsWin.document.write(`
          <!DOCTYPE html>
          <html>
            <head><title>JS Preview</title></head>
            <body>
              <div id="result"></div>
              <script>${code}</script>
            </body>
          </html>
        `);
        jsWin.document.close();
      } else {
        sensei.textContent =
          "👩‍💻 Sensei says: Preview not supported for this language!";
      }
    } else {
      sensei.textContent = "👩‍💻 Sensei says: No code to preview!";
    }
  });

  // Voice Recognition
  let recognition;
  if ("webkitSpeechRecognition" in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () =>
      (sensei.textContent = "👩‍💻 Sensei says: Listening...");
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      promptTextarea.value = transcript;
      sensei.textContent = "👩‍💻 Sensei says: Processing your query...";
      if (transcript) {
        console.log("Sending prompt:", {
          type: "prompt",
          text: transcript,
          feature: selectedFeature,
        });
        ws.send(
          JSON.stringify({
            type: "prompt",
            text: transcript,
            feature: selectedFeature,
          })
        );
        promptTextarea.value = "";
      }
    };
    recognition.onerror = (event) =>
      (sensei.textContent = "👩‍💻 Sensei says: Error: " + event.error);
    recognition.onend = () => (sensei.textContent = "👩‍💻 Sensei says: Ready!");
  } else {
    voiceInputBtn.disabled = true;
    sensei.textContent = "👩‍💻 Sensei says: Voice not supported.";
  }

  voiceInputBtn.addEventListener(
    "click",
    () => recognition && recognition.start()
  );

  // Screen Sharing
  const screenPreview = document.createElement("video");
  screenPreview.id = "screen-preview";
  screenPreview.autoplay = true;
  screenPreview.muted = true;
  screenPreview.style.display = "none";
  document.body.appendChild(screenPreview);

  screenShareBtn.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false,
      });
      screenPreview.srcObject = stream;
      screenPreview.style.display = "block";
      sensei.textContent = "👩‍💻 Sensei says: Screen sharing started!";

      const videoTrack = stream.getVideoTracks()[0];
      const imageCapture = new ImageCapture(videoTrack);
      const bitmap = await imageCapture.grabFrame();
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas
        .getContext("2d")
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const image = canvas.toDataURL("image/png");
      console.log("Sending screenCapture:", {
        type: "screenCapture",
        image: image.slice(0, 50) + "...",
      });
      ws.send(JSON.stringify({ type: "screenCapture", image }));

      stream.getVideoTracks()[0].onended = () => {
        screenPreview.style.display = "none";
        sensei.textContent = "👩‍💻 Sensei says: Screen sharing stopped!";
      };
    } catch (error) {
      sensei.textContent = "👩‍💻 Sensei says: Error: " + error.message;
    }
  });

  // WebSocket Handlers
  ws.onopen = () => {
    console.log("WebSocket connected");
    sensei.textContent = "👩‍💻 Sensei says: Connected!";
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    sensei.textContent = "👩‍💻 Sensei says: WebSocket connection failed!";
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("Received from server:", data);
    errorDisplay.textContent = "";

    switch (data.type) {
      case "aiCode":
        aiEditor.setValue(data.code);
        addToTimeline(
          data.summaryTitle || "AI Generated",
          data.code,
          data.error
        );
        break;
      case "suggestion":
        aiEditor.setValue(data.code);
        addToTimeline("Suggestion Applied", data.code);
        break;
      case "languageOptions":
        if (featureSelect.value === "language") {
          subFeatureSelect.innerHTML =
            '<option value="">Select Language</option>';
          data.options.languages.forEach((lang) => {
            const option = document.createElement("option");
            option.value = lang;
            option.textContent = lang;
            subFeatureSelect.appendChild(option);
          });
          subFeatureSelect.style.display = "block";
        }
        break;
      case "feedbackAck":
        sensei.textContent = "👩‍💻 Sensei says: Thanks for your feedback!";
        break;
      case "screenCaptureResponse":
        aiEditor.setValue(data.code);
        sensei.textContent = "👩‍💻 Sensei says: Screen processed!";
        addToTimeline("Screen Capture", data.code);
        break;
      case "sessionCreated":
        sessionInfo.textContent = `Session ID: ${data.sessionId}`;
        collabModal.style.display = "block";
        sensei.textContent = "👩‍💻 Sensei says: Session started!";
        break;
      case "sessionJoined":
        sessionInfo.textContent = `Joined session: ${data.sessionId}`;
        userEditor.setValue(data.code);
        collabModal.style.display = "none";
        sensei.textContent = "👩‍💻 Sensei says: Joined session!";
        break;
      case "collabUpdate":
        if (!data.fromSelf) {
          userEditor.setValue(data.code);
          sensei.textContent = "👩‍💻 Sensei says: Code updated by collaborator!";
        }
        break;
      case "error":
        errorDisplay.textContent = data.message;
        sensei.textContent = "👩‍💻 Sensei says: Error - " + data.message;
        addToTimeline("Error: " + data.requestTitle, null, data.error);
        break;
      case "modelUpdated":
        currentModel = data.model;
        sensei.textContent = `👩‍💻 Sensei says: Model updated to ${data.model}!`;
        break;
      default:
        console.log("Unhandled message type:", data.type);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket closed");
    sensei.textContent = "👩‍💻 Sensei says: Connection lost. Restart the server!";
  };

  // Feature Selector Logic
  window.updateFeatureOptions = () => {
    const feature = featureSelect.value;
    subFeatureSelect.innerHTML = '<option value="">Select Option</option>';
    subFeatureSelect.style.display = "block";

    if (feature === "language") {
      const code = userEditor.getValue();
      if (code) {
        console.log("Sending codeUpdate for language options:", {
          type: "codeUpdate",
          code,
        });
        ws.send(JSON.stringify({ type: "codeUpdate", code }));
      } else {
        sensei.textContent =
          "👩‍💻 Sensei says: Please enter code to change language!";
        subFeatureSelect.style.display = "none";
      }
    } else if (feature === "duet") {
      const styles = ["verbose"];
      styles.forEach((style) => {
        const option = document.createElement("option");
        option.value = style;
        option.textContent = style;
        subFeatureSelect.appendChild(option);
      });
    } else if (feature === "correction") {
      const option = document.createElement("option");
      option.value = "apply";
      option.textContent = "Apply Auto-Correction";
      subFeatureSelect.appendChild(option);
    } else if (feature === "mood") {
      const actions = ["toggle"];
      actions.forEach((action) => {
        const option = document.createElement("option");
        option.value = action;
        option.textContent = "Toggle Mood Enhancer";
        subFeatureSelect.appendChild(option);
      });
    } else if (feature === "time") {
      const option = document.createElement("option");
      option.value = "restore";
      option.textContent = "Restore Latest Code";
      subFeatureSelect.appendChild(option);
    } else {
      subFeatureSelect.style.display = "none";
    }
  };

  window.executeFeature = () => {
    const feature = featureSelect.value;
    const subFeature = subFeatureSelect.value;

    if (!feature || !subFeature) return;

    if (feature === "language") {
      const code = userEditor.getValue();
      if (subFeature && code) {
        console.log("Sending changeLanguage:", {
          type: "changeLanguage",
          language: subFeature,
          code,
          requestTitle: `Convert to ${subFeature}`,
        });
        ws.send(
          JSON.stringify({
            type: "changeLanguage",
            language: subFeature,
            code,
            requestTitle: `Convert to ${subFeature}`,
          })
        );
      } else {
        sensei.textContent =
          "👩‍💻 Sensei says: Please select a language and ensure code is present!";
      }
    } else if (feature === "duet") {
      const style = subFeature;
      if (style) {
        console.log("Sending duetCode:", {
          type: "duetCode",
          style,
          code: userEditor.getValue(),
          requestTitle: `Duet Style: ${style}`,
        });
        ws.send(
          JSON.stringify({
            type: "duetCode",
            style,
            code: userEditor.getValue(),
            requestTitle: `Duet Style: ${style}`,
          })
        );
      }
    } else if (feature === "correction" && subFeature === "apply") {
      const code = userEditor.getValue();
      console.log("Sending codeUpdate:", {
        type: "codeUpdate",
        code,
        requestComment: true,
        requestTitle: "Auto-Correction",
      });
      ws.send(
        JSON.stringify({
          type: "codeUpdate",
          code,
          requestComment: true,
          requestTitle: "Auto-Correction",
        })
      );
    } else if (feature === "mood" && subFeature === "toggle") {
      moodEnabled = !moodEnabled;
      if (moodEnabled) {
        moodAudio.src =
          "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
        moodAudio.play();
        sensei.textContent = "👩‍💻 Sensei says: Mood enhancer on!";
      } else {
        moodAudio.pause();
        sensei.textContent = "👩‍💻 Sensei says: Mood enhancer off!";
      }
    } else if (feature === "time" && subFeature === "restore") {
      console.log("Sending timeMachine:", {
        type: "timeMachine",
        history: timeline,
      });
      ws.send(JSON.stringify({ type: "timeMachine", history: timeline }));
    }
  };

  // Helper Functions
  function addToTimeline(title, code, error) {
    timeline.push({
      title,
      code,
      error,
      timestamp: new Date().toLocaleTimeString(),
    });
    const languageIdentifiers = [
      "html",
      "javascript",
      "css",
      "python",
      "java",
      "cpp",
      "c",
      "ruby",
      "go",
      "rust",
      "php",
      "typescript",
    ];
    let displayCode = code || "";
    const lines = displayCode.split("\n");
    if (
      lines.length > 0 &&
      languageIdentifiers.includes(lines[0].trim().toLowerCase())
    ) {
      displayCode = lines.slice(1).join("\n").trim();
    }
    const summary = displayCode ? displayCode.slice(0, 20) + "..." : "No code";
    const li = document.createElement("li");
    li.innerHTML = `<strong>${title}</strong> (${timeline.length})<br><small>${
      error ? `Error: ${error}` : summary
    }</small>`;
    li.title = error || code || title;
    li.addEventListener("click", () => {
      if (code) {
        userEditor.setValue(code);
        sensei.textContent = `👩‍💻 Sensei says: Loaded ${title} from history!`;
      } else {
        sensei.textContent = `👩‍💻 Sensei says: No code to load for ${title}!`;
      }
    });
    historyList.appendChild(li);
  }

  // Event Listeners
  document.getElementById("submitPrompt").addEventListener("click", () => {
    const prompt = promptTextarea.value.trim();
    if (prompt) {
      console.log("Sending prompt:", {
        type: "prompt",
        text: prompt,
        feature: "aiHelp",
      });
      ws.send(
        JSON.stringify({
          type: "prompt",
          text: prompt,
          feature: "aiHelp",
          requestTitle: prompt,
        })
      );
      promptTextarea.value = "";
    }
  });

  comeAndCodeBtn.addEventListener("click", () => {
    collabModal.style.display = "block";
  });

  closeCollabModal.addEventListener("click", () => {
    collabModal.style.display = "none";
  });

  startCollabBtn.addEventListener("click", () => {
    const currentCode = userEditor.getValue();
    console.log("Sending startCollab:", {
      type: "startCollab",
      code: currentCode,
    });
    ws.send(JSON.stringify({ type: "startCollab", code: currentCode }));
  });

  joinCollabBtn.addEventListener("click", () => {
    const sessionId = sessionIdInput.value.trim();
    if (sessionId) {
      console.log("Sending joinCollab:", { type: "joinCollab", sessionId });
      ws.send(JSON.stringify({ type: "joinCollab", sessionId }));
    } else {
      sensei.textContent = "👩‍💻 Sensei says: Enter a valid session ID!";
    }
  });

  userEditor.onDidChangeModelContent(() => {
    const sessionId = sessionInfo.textContent.split(": ")[1]?.trim();
    if (sessionId) {
      const updatedCode = userEditor.getValue();
      console.log("Sending collabUpdate:", {
        type: "collabUpdate",
        sessionId,
        code: updatedCode,
      });
      ws.send(
        JSON.stringify({ type: "collabUpdate", sessionId, code: updatedCode })
      );
    }
  });

  copyCodeBtn.addEventListener("click", () => {
    const code = aiEditor.getValue();
    if (code && code !== "// AI suggestions will appear here") {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          sensei.textContent = "👩‍💻 Sensei says: Code copied to clipboard!";
        })
        .catch((err) => {
          sensei.textContent = "👩‍💻 Sensei says: Failed to copy code!";
          console.error("Copy error:", err);
        });
    }
  });

  historyBtn.addEventListener("click", () => {
    historyModal.style.display = "block";
    historyList.innerHTML = "";
    timeline.forEach((item) =>
      addToTimeline(item.title, item.code, item.error)
    );
  });

  closeHistory.addEventListener("click", () => {
    historyModal.style.display = "none";
  });

  // Feedback Handlers
  document.getElementById("feedback-good").addEventListener("click", () => {
    const lastCode = aiEditor.getValue();
    if (lastCode && lastCode !== "// AI suggestions will appear here") {
      console.log("Sending feedback:", {
        type: "feedback",
        query: lastCode,
        value: "good",
      });
      ws.send(
        JSON.stringify({ type: "feedback", query: lastCode, value: "good" })
      );
    }
  });

  document.getElementById("feedback-bad").addEventListener("click", () => {
    const lastCode = aiEditor.getValue();
    if (lastCode && lastCode !== "// AI suggestions will appear here") {
      console.log("Sending feedback:", {
        type: "feedback",
        query: lastCode,
        value: "bad",
      });
      ws.send(
        JSON.stringify({ type: "feedback", query: lastCode, value: "bad" })
      );
    }
  });

  // AI Help Button
  document.getElementById("aiHelp").addEventListener("click", () => {
    const code = userEditor.getValue();
    if (code) {
      console.log("Sending aiHelp:", { type: "aiHelp", code });
      ws.send(
        JSON.stringify({ type: "aiHelp", code, requestTitle: "AI Help" })
      );
    } else {
      sensei.textContent =
        "👩‍💻 Sensei says: Please enter some code to get AI help!";
    }
  });
});
