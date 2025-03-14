require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.0/min/vs",
  },
});
require(["vs/editor/editor.main"], function () {
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

  const ws = new WebSocket("ws://localhost:3000");
  const previewFrame = document.getElementById("preview-frame");
  const errorDisplay = document.getElementById("error-display");
  const timelineList = document.getElementById("timeline-list");
  const chatInput = document.getElementById("chat-input");
  const chatOutput = document.getElementById("chat-output");
  const snippetList = document.getElementById("snippet-list");
  const sensei = document.getElementById("sensei");
  const languageSelect = document.getElementById("language-select");
  const applyCorrectionBtn = document.getElementById("apply-correction");
  const toggleMoodBtn = document.getElementById("toggle-mood");
  const timeMachineBtn = document.getElementById("time-machine");
  const duetStyleSelect = document.getElementById("duet-style");
  const comeAndCodeBtn = document.getElementById("come-and-code");
  const collabModal = document.getElementById("collab-modal");
  const closeModal = document.getElementById("close-modal");
  const startCollabBtn = document.getElementById("start-collab");
  const joinCollabBtn = document.getElementById("join-collab");
  const sessionIdInput = document.getElementById("session-id");
  const sessionInfo = document.getElementById("session-info");
  const moodAudio = document.getElementById("mood-audio");
  const previewCodeBtn = document.getElementById("preview-code");
  let timeline = [];
  let snippets = [];
  let moodEnabled = false;

  // Voice Recognition
  const voiceInputBtn = document.getElementById("voiceInput");
  const promptTextarea = document.getElementById("prompt");

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
        console.log("Sending prompt:", { type: "prompt", text: transcript });
        ws.send(JSON.stringify({ type: "prompt", text: transcript }));
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
  const screenShareBtn = document.getElementById("screenShare");
  const screenPreview = document.getElementById("screen-preview");

  screenShareBtn.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false,
      });
      screenPreview.srcObject = stream;
      screenPreview.style.display = "block";
      sensei.textContent = "👩‍💻 Sensei says: Screen sharing started!";
      speak("Screen sharing started!");

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
        speak("Screen sharing stopped!");
      };
    } catch (error) {
      sensei.textContent = "👩‍💻 Sensei says: Error: " + error.message;
      speak("Error: " + error.message);
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
      case "chatResponse":
        chatOutput.innerHTML += `<p><em>You:</em> ${chatInput.value}<br><em>Sensei:</em> ${data.message}</p>`;
        chatOutput.scrollTop = chatOutput.scrollHeight;
        chatInput.value = "";
        break;
      case "aiCode":
        aiEditor.setValue(data.code);
        addToTimeline(
          data.summaryTitle || "AI Generated",
          data.code,
          data.error
        );
        speak("AI generated code!");
        break;
      case "suggestion":
        aiEditor.setValue(data.code);
        addToTimeline("Suggestion Applied", data.code);
        speak("Code suggestion ready!");
        break;
      case "snippet":
        addSnippet(data.code, data.explanation);
        speak("Snippet added!");
        break;
      case "languageOptions":
        languageSelect.innerHTML = '<option value="">Change Language</option>';
        data.options.languages.forEach((lang) => {
          const option = document.createElement("option");
          option.value = lang;
          option.textContent = lang;
          languageSelect.appendChild(option);
        });
        break;
      case "feedbackAck":
        chatOutput.innerHTML += `<p><em>Sensei:</em> ${data.message}</p>`;
        chatOutput.scrollTop = chatOutput.scrollHeight;
        break;
      case "screenCaptureResponse":
        aiEditor.setValue(data.code);
        sensei.textContent = "👩‍💻 Sensei says: Screen processed!";
        speak("Screen processed!");
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
        addToTimeline("Error: " + data.requestTitle, null, data.message);
        break;
      case "modelUpdated":
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

  // Helper Functions
  function updatePreview(code, requestTitle) {
    if (!code || code.trim() === "// AI suggestions will appear here") {
      sensei.textContent = "👩‍💻 Sensei says: No AI-generated code to preview!";
      return;
    }

    // Detect if the code is web-based (contains HTML, CSS, or JavaScript)
    const isWebBased = code.match(/<!DOCTYPE|html|head|body|style|script/i);
    if (isWebBased) {
      // For HTML content, inject the entire code directly
      const newTab = window.open("", "_blank");
      if (newTab) {
        newTab.document.write(code);
        newTab.document.close();
        sensei.textContent = "👩‍💻 Sensei says: Preview opened in new tab!";
      } else {
        sensei.textContent =
          "👩‍💻 Sensei says: Unable to open new tab. Allow popups!";
      }
    } else {
      // For programming language code, display in terminal
      const terminalOutput = document.createElement("pre");
      terminalOutput.textContent = code;
      terminalOutput.style.margin = "10px 0";
      terminalOutput.style.padding = "10px";
      terminalOutput.style.background = "#21262d";
      terminalOutput.style.borderRadius = "6px";
      terminalOutput.style.color = "#c9d1d9";
      errorDisplay.appendChild(terminalOutput);
      sensei.textContent = "👩‍💻 Sensei says: Code displayed in terminal!";
    }
  }

  function addSnippet(code, explanation) {
    snippets.push({ code, explanation });
    const li = document.createElement("li");
    li.innerHTML = `<strong>${code.slice(0, 20) + "..."}</strong><br><small>${
      explanation || "No explanation"
    }</small>`;
    li.title = code;
    li.addEventListener("click", () => {
      userEditor.setValue(code);
      sensei.textContent = "👩‍💻 Sensei says: Snippet applied!";
    });
    snippetList.appendChild(li);
  }

  function addToTimeline(title, code, error) {
    timeline.push({
      title,
      code,
      error,
      timestamp: new Date().toLocaleTimeString(),
    });

    // Skip the first line if it matches a language identifier
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

    // Use the first 20 characters of the remaining code for the summary
    const summary = displayCode ? displayCode.slice(0, 20) + "..." : "No code";

    const li = document.createElement("li");
    li.innerHTML = `<strong>${title}</strong> (${timeline.length})<br><small>${
      error ? `Error: ${error}` : summary
    }</small>`;
    li.title = error || code || title;
    li.addEventListener("click", () => {
      if (code) {
        userEditor.setValue(code);
        sensei.textContent = `👩‍💻 Sensei says: Loaded ${title} from timeline!`;
      } else {
        sensei.textContent = `👩‍💻 Sensei says: No code to load for ${title}!`;
      }
    });
    timelineList.appendChild(li);
    timelineList.scrollTop = timelineList.scrollHeight;
  }

  function speak(text) {
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      window.speechSynthesis.speak(utterance);
    }
  }

  // Event Listeners
  document.getElementById("chat-submit").addEventListener("click", () => {
    const query = chatInput.value.trim();
    if (query) {
      console.log("Sending chatQuery:", { type: "chatQuery", query });
      ws.send(JSON.stringify({ type: "chatQuery", query }));
      chatOutput.innerHTML += `<p><em>You:</em> ${query}<br></p>`;
    }
  });

  document.getElementById("submitPrompt").addEventListener("click", () => {
    const prompt = promptTextarea.value.trim();
    if (prompt) {
      console.log("Sending prompt:", { type: "prompt", text: prompt });
      ws.send(
        JSON.stringify({ type: "prompt", text: prompt, requestTitle: prompt })
      );
      promptTextarea.value = "";
    }
  });

  document.getElementById("fetch-snippet").addEventListener("click", () => {
    console.log("Sending snippetRequest");
    ws.send(JSON.stringify({ type: "snippetRequest" }));
  });

  window.changeLanguage = () => {
    const language = languageSelect.value;
    const code = userEditor.getValue();
    if (language && code) {
      console.log("Sending changeLanguage:", {
        type: "changeLanguage",
        language,
        code,
        requestTitle: `Convert to ${language}`,
      });
      ws.send(
        JSON.stringify({
          type: "changeLanguage",
          language,
          code,
          requestTitle: `Convert to ${language}`,
        })
      );
    } else {
      sensei.textContent =
        "👩‍💻 Sensei says: Please select a language and ensure code is present!";
    }
  };

  applyCorrectionBtn.addEventListener("click", () => {
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
  });

  toggleMoodBtn.addEventListener("click", () => {
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
  });

  timeMachineBtn.addEventListener("click", () => {
    console.log("Sending timeMachine:", {
      type: "timeMachine",
      history: timeline,
    });
    ws.send(JSON.stringify({ type: "timeMachine", history: timeline }));
  });

  window.startDuet = () => {
    const style = duetStyleSelect.value;
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
  };

  comeAndCodeBtn.addEventListener("click", () => {
    collabModal.style.display = "block";
  });

  closeModal.addEventListener("click", () => {
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

  previewCodeBtn.addEventListener("click", () => {
    const aiCode = aiEditor.getValue().trim();
    if (!aiCode || aiCode === "// AI suggestions will appear here") {
      sensei.textContent = "👩‍💻 Sensei says: No AI-generated code to preview!";
      return;
    }
    updatePreview(aiCode, "Preview");
  });

  // Model Selection
  const modelSelect = document.createElement("select");
  modelSelect.id = "model-select";
  modelSelect.innerHTML = `
    <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
    <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
  `;
  document.querySelector(".controls-section").prepend(modelSelect);

  modelSelect.addEventListener("change", () => {
    const model = modelSelect.value;
    console.log("Sending modelUpdate:", { type: "modelUpdate", model });
    ws.send(JSON.stringify({ type: "modelUpdate", model }));
  });
});
