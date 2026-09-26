let mediaRecorder;
let audioChunks = [];
let startTime;
let timerInterval;
let db;
let supportedMimeType = '';

// Identifiera stödda ljudformat för webbläsaren
function getBestMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg'
  ];
  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

// IndexedDB Setup
const request = indexedDB.open("VoiceRecorderDB", 1);
request.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("recordings")) {
    db.createObjectStore("recordings", { keyPath: "id", autoIncrement: true });
  }
};
request.onsuccess = (e) => {
  db = e.target.result;
  loadRecordings();
  initSettingsModal();
};

// UI Elements & Navigation
const tabRecord = document.getElementById("tab-record");
const tabListen = document.getElementById("tab-listen");
const viewRecord = document.getElementById("view-record");
const viewListen = document.getElementById("view-listen");
const recordBtn = document.getElementById("record-btn");
const timerEl = document.getElementById("timer");

tabRecord.addEventListener("click", () => {
  tabRecord.classList.add("active");
  tabListen.classList.remove("active");
  viewRecord.classList.add("active");
  viewListen.classList.remove("active");
});

tabListen.addEventListener("click", () => {
  tabListen.classList.add("active");
  tabRecord.classList.remove("active");
  viewListen.classList.add("active");
  viewRecord.classList.remove("active");
  loadRecordings();
});

// Inspelningslogik
recordBtn.addEventListener("click", async () => {
  try {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      supportedMimeType = getBestMimeType();
      const options = supportedMimeType ? { mimeType: supportedMimeType } : {};

      mediaRecorder = new MediaRecorder(stream, options);
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        saveRecording();
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      recordBtn.classList.add("recording");
      startTimer();
    } else {
      mediaRecorder.stop();
      recordBtn.classList.remove("recording");
      stopTimer();
    }
  } catch (err) {
    alert("Kunde inte starta mikrofonen. Tillåt åtkomst i webbläsaren.");
  }
});

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const hrs = String(Math.floor(elapsed / 3600)).padStart(2, "0");
    const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
    const secs = String(elapsed % 60).padStart(2, "0");
    timerEl.textContent = `${hrs}:${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerEl.textContent = "00:00:00";
}

function saveRecording() {
  const mimeType = supportedMimeType || "audio/webm";
  const blob = new Blob(audioChunks, { type: mimeType });
  const tx = db.transaction("recordings", "readwrite");
  const store = tx.objectStore("recordings");
  store.add({
    blob: blob,
    mimeType: mimeType,
    date: new Date().toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "medium" })
  });
}

function loadRecordings() {
  const list = document.getElementById("audio-list");
  list.innerHTML = "";
  if (!db) return;

  const tx = db.transaction("recordings", "readonly");
  const store = tx.objectStore("recordings");
  
  store.getAll().onsuccess = (e) => {
    const items = e.target.result;
    items.reverse().forEach((record) => {
      const wrapper = document.createElement("li");
      wrapper.className = "audio-item-wrapper";
      
      const recordBlob = new Blob([record.blob], { type: record.mimeType || "audio/webm" });
      const url = URL.createObjectURL(recordBlob);
      
      wrapper.innerHTML = `
        <div class="swipe-delete-bg">🗑️ Radera</div>
        <div class="audio-item" data-id="${record.id}">
          <header>
            <div class="audio-date">${record.date}</div>
            <button class="delete-x-btn" onclick="deleteRecord(${record.id})">✕</button>
          </header>
          <audio controls controlsList="nodownload noplaybackrate" src="${url}"></audio>
        </div>
      `;

      list.appendChild(wrapper);
      initSwipe(wrapper.querySelector(".audio-item"), record.id);
    });
  };
}

// Swipe to delete
function initSwipe(element, id) {
  let startX = 0;
  let currentX = 0;

  element.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
  }, { passive: true });

  element.addEventListener('touchmove', (e) => {
    currentX = e.touches[0].clientX;
    const diffX = currentX - startX;
    if (diffX < 0 && diffX > -120) {
      element.style.transform = `translateX(${diffX}px)`;
    }
  }, { passive: true });

  element.addEventListener('touchend', () => {
    const diffX = currentX - startX;
    if (diffX < -80) {
      element.style.transform = `translateX(-100%)`;
      setTimeout(() => deleteRecord(id), 200);
    } else {
      element.style.transform = `translateX(0)`;
    }
    startX = 0;
    currentX = 0;
  });
}

function deleteRecord(id) {
  const tx = db.transaction("recordings", "readwrite");
  tx.objectStore("recordings").delete(id);
  tx.oncomplete = () => loadRecordings();
}

// --- IMPORT / EXPORT JSON LOGIK ---

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, defaultType = 'audio/webm') {
  const parts = base64.split(';base64,');
  const contentType = parts[0].replace('data:', '') || defaultType;
  const raw = window.atob(parts[1] || parts[0]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);

  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], { type: contentType });
}

function initSettingsModal() {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettings = document.getElementById('close-settings');
  const exportBtn = document.getElementById('export-btn');
  const importFile = document.getElementById('import-file');

  if (!settingsBtn || !settingsModal) return;

  settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  closeSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

  window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
    }
  });

  // Exportera alla röstinspelningar från IndexedDB till JSON
  exportBtn.addEventListener('click', () => {
    if (!db) return;

    const tx = db.transaction("recordings", "readonly");
    const store = tx.objectStore("recordings");

    store.getAll().onsuccess = async (e) => {
      const records = e.target.result;
      if (!records || records.length === 0) {
        alert("Det finns inga inspelningar att exportera.");
        return;
      }

      try {
        const exportData = await Promise.all(
          records.map(async (rec) => {
            const base64Audio = await blobToBase64(rec.blob);
            return {
              id: rec.id,
              date: rec.date,
              mimeType: rec.mimeType || 'audio/webm',
              audioBase64: base64Audio
            };
          })
        );

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `voice-recordings-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert("Kunde inte exportera inspelningarna.");
      }
    };
  });

  // Importera röstinspelningar från JSON till IndexedDB
  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedItems = JSON.parse(event.target.result);
        if (!Array.isArray(importedItems)) {
          alert("Ogiltigt JSON-format.");
          return;
        }

        const tx = db.transaction("recordings", "readwrite");
        const store = tx.objectStore("recordings");

        importedItems.forEach((item) => {
          if (item.audioBase64) {
            const blob = base64ToBlob(item.audioBase64, item.mimeType || 'audio/webm');
            store.add({
              blob: blob,
              mimeType: item.mimeType || 'audio/webm',
              date: item.date || new Date().toLocaleString("sv-SE")
            });
          }
        });

        tx.oncomplete = () => {
          alert("Inspelningarna har importerats!");
          settingsModal.classList.add("hidden");
          loadRecordings();
        };
      } catch (err) {
        alert("Det gick inte att läsa JSON-filen.");
      }
    };
    reader.readAsText(file);
  });
}
