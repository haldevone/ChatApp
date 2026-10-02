// SignalR-anslutning till chatthubben
const connection = new signalR.HubConnectionBuilder()
    .withUrl("/chatHub")
    .withAutomaticReconnect()
    .build();

let currentGroup = null;
let currentRoomId = null;
let currentRoomKey = null;
let myPrivateKey = null;

const groupPanel = document.getElementById("groupPanel");
const activeGroupBox = document.getElementById("activeGroupBox");
const activeGroupName = document.getElementById("activeGroupName");
const leaveGroupBtn = document.getElementById("leaveGroupBtn");

const statusBadge = document.getElementById("connectionStatus");
const messagesBox = document.getElementById("messagesBox");
const groupInput = document.getElementById("groupNameInput");
const joinBtn = document.getElementById("joinGroupBtn");
const currentGroupLabel = document.getElementById("currentGroupLabel");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const membersPanel = document.getElementById("membersPanel");
const membersList = document.getElementById("membersList");
const typingIndicator = document.getElementById("typingIndicator");

let typingTimeout = null;
let hideTypingTimer = null;

// När användaren skriver i meddelandeinputen, skicka "NotifyTyping"-signalR till servern
messageInput.addEventListener("input", () => {
    if (!currentGroup) return;
    connection.invoke("NotifyTyping", currentGroup).catch(err => console.error(err));
});

// Skicka meddelande när användaren trycker på Enter
messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
});

// Uppdatera UI för anslutningsstatus
function setConnectedUi(isConnected) {
    statusBadge.textContent = isConnected ? "Ansluten" : "Frånkopplad";
    statusBadge.className = "status-badge " + (isConnected ? "status-connected" : "status-disconnected");
}

// Lägg till ett meddelande i chatten, skicka avsändare, meddelandetext, tidpunkt. 
//Om det är ett systemmeddelande(t.ex. "Användare anslöt") visas det utan avsändare.
function addMessage({ sender, text, isOwn, isSystem, sentAt }) {
    const empty = messagesBox.querySelector(".empty-state");
    if (empty) empty.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "message" + (isOwn ? " own" : "") + (isSystem ? " system" : "");

    if (!isSystem) {
        const senderEl = document.createElement("div");
        senderEl.className = "message-sender";
        senderEl.textContent = sender;
        wrapper.appendChild(senderEl);
    }

    const textEl = document.createElement("div");

    // textContent (inte innerHTML) används genomgående för att rendera
    // meddelandetext, avsändarnamn och gruppnamn - förhindrar XSS genom att
    // all inskickad text alltid tolkas som text, aldrig som körbar HTML/JS.
    textEl.textContent = text;
    wrapper.appendChild(textEl);

    if (!isSystem) {
        const timeEl = document.createElement("div");
        timeEl.className = "message-time";
        const time = sentAt ? new Date(sentAt) : new Date();
        timeEl.textContent = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        wrapper.appendChild(timeEl);
    }

    messagesBox.appendChild(wrapper);
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

// Byt grupp, lämna nuvarande grupp om det finns en, och gå med i den nya gruppen.
async function switchGroup(newGroupName) {
    if (newGroupName === currentGroup) return;

    if (currentGroup) {
        await connection.invoke("LeaveGroup", currentGroup);
        currentGroup = null;
        activeGroupBox.style.display = "none";
        groupPanel.style.display = "flex";
        messageInput.disabled = true;
        sendBtn.disabled = true;
    }

    if (newGroupName) {
        await connection.invoke("JoinGroup", newGroupName);
    }
}

// Lyssna efter meddelande från servern. Ta emot meddelande från servern, dekryptera det med rummets AES-GCM-nyckel
// och sänd meddelandet till addMessage-funktionen som renderar det i UI:t.
connection.on("ReceiveMessage", async (sender, encryptedText, iv, sentAtUtc) => {
    if (!currentRoomKey) return;

    const plaintext = await decryptMessage(encryptedText, iv);
    addMessage({ sender, text: plaintext, isOwn: sender === currentUserName, sentAt: sentAtUtc });
});

// Lyssna efter systemmeddelanden om användare som ansluter, lämnar eller skriver i chatten.
connection.on("UserJoined", (userName) => {
    addMessage({ text: `${userName} anslöt till gruppen`, isSystem: true });
});

// Lyssna efter systemmeddelanden om användare som lämnar chatten.
connection.on("UserLeft", (userName) => {
    addMessage({ text: `${userName} lämnade gruppen`, isSystem: true });
});

// Lyssna efter systemmeddelanden om användare som skriver i chatten.
connection.on("UserTyping", (userName) => {
    typingIndicator.textContent = `${userName} skriver...`;
    clearTimeout(hideTypingTimer);

    hideTypingTimer = setTimeout(() => {
        typingIndicator.textContent = "";
    }, 2000);
});

// Lyssna efter systemmeddelanden om att användaren har blivit tillagd i ett rum.
connection.on("AddedToRoom", (roomId, roomName) => {
    const badge = document.createElement("span");
    badge.className = "room-badge";
    badge.dataset.roomName = roomName;
    badge.textContent = roomName;
    badge.addEventListener("click", () => switchGroup(roomName));
    document.getElementById("myRoomsList").appendChild(badge);
});

connection.on("JoinDenied", (groupName) => {
    alert(`Du har inte behörighet till rummet "${groupName}".`);
});

// Lyssna efter historikmeddelanden från servern. Dekryptera varje meddelande med rummets AES-GCM-nyckel
connection.on("LoadHistory", async (messages) => {
    messagesBox.innerHTML = "";
    for (const m of messages) {
        const plaintext = await decryptMessage(m.text, m.iv);
        addMessage({
            sender: m.senderName,
            text: plaintext,
            isOwn: m.senderName === currentUserName,
            sentAt: m.sentAtUtc
        });
    }
});

// Lyssna efter godkännande att gå med i ett rum. Spara rummets AES-GCM-nyckel lokalt om den inte redan finns.
connection.on("JoinApproved", async (groupName, roomId) => {
    currentGroup = groupName;
    currentRoomId = roomId;
    groupPanel.style.display = "none";
    activeGroupBox.style.display = "flex";

    activeGroupName.textContent = "Du är i rum: ";
    const boldName = document.createElement("span");
    boldName.style.fontWeight = "700";
    boldName.style.textTransform = "uppercase";
    boldName.textContent = groupName;
    activeGroupName.appendChild(boldName);

    messageInput.disabled = false;
    sendBtn.disabled = false;
    groupInput.value = "";

    currentRoomKey = await loadRoomKeyLocally(roomId);

    if (!currentRoomKey) {
        const response = await fetch(`/Chat/GetMyEncryptedRoomKey?roomId=${roomId}`);
        if (!response.ok) {
            alert("Kunde inte hämta rumsnyckel.");
            return;
        }
// Hämta den krypterade rumsnyckeln, IV och ägarens publika nyckel från servern
        const { encryptedKey, iv, ownerPublicKey } = await response.json();

        try {
// Importera ägarens publika ECDH-nyckel och deriviera en delad hemlighet med ECDH
            const ownerKey = await crypto.subtle.importKey(
                "jwk", JSON.parse(ownerPublicKey), { name: "ECDH", namedCurve: "P-256" }, true, []
            );
            const sharedSecret = await crypto.subtle.deriveKey(
                { name: "ECDH", public: ownerKey },
                myPrivateKey,
                { name: "AES-GCM", length: 256 },
                false, ["encrypt", "decrypt"]
            );
            const rawRoomKey = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: base64ToArrayBuffer(iv) },
                sharedSecret,
                base64ToArrayBuffer(encryptedKey)
            );
            currentRoomKey = await crypto.subtle.importKey(
                "raw", rawRoomKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]
            );
            await saveRoomKeyLocally(roomId, currentRoomKey);
        } catch (err) {
            console.error("Dekryptering av rumsnyckel misslyckades:", err);
        }
    }
});

joinBtn.addEventListener("click", async () => {
    const groupName = groupInput.value.trim();
    if (!groupName) return;
    switchGroup(groupName);
});

leaveGroupBtn.addEventListener("click", async () => {
    if (!currentGroup) return;
    switchGroup(null);
});

sendBtn.addEventListener("click", () => {
    sendMessage();
});

// Skicka meddelande till servern.
async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentGroup || !currentRoomKey) return;

    // Meddelandet krypteras client-side med rummets AES-GCM-nyckel innan
    // det någonsin skickas till servern - end-to-end-kryptering.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv }, currentRoomKey, encoded
    );

    await connection.invoke(
        "SendMessageToGroup",
        currentGroup,
        arrayBufferToBase64(ciphertext),
        arrayBufferToBase64(iv)
    );
    messageInput.value = "";
}

// Lägg till medlem i rum. Kryptera rummets AES-GCM-nyckel med den nya medlemmens publika ECDH-nyckel
document.getElementById("addMemberForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const roomId = Number(document.getElementById("addMemberRoomId").value);
    const userName = document.getElementById("addMemberUserName").value.trim();
    if (!roomId || !userName) return;

// Skicka POST-request till servern för att lägga till medlem i rummet
    const addResponse = await fetch("/Chat/AddMember", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `roomId=${roomId}&userName=${encodeURIComponent(userName)}&__RequestVerificationToken=${encodeURIComponent(antiForgeryToken)}`
    });

    if (!addResponse.ok) {
        alert("Kunde inte lägga till medlem (fel rum-ID eller inte ägare).");
        return;
    }

    const addResult = await addResponse.json();
    const targetUserId = addResult.userId;

// Hämta den nya medlemmens publika ECDH-nyckel från servern
    const keyResponse = await fetch(`/Chat/GetPublicKey?userName=${encodeURIComponent(userName)}`);
    if (!keyResponse.ok) {
        alert("Medlem tillagd, men saknar publik nyckel (har inte loggat in i chatten än).");
        return;
    }
    const { publicKey } = await keyResponse.json();
// Importera den nya medlemmens publika nyckel och deriviera en delad hemlighet med ECDH
    const memberPublicKey = await crypto.subtle.importKey(
        "jwk", JSON.parse(publicKey), { name: "ECDH", namedCurve: "P-256" }, true, []
    );

    const sharedSecret = await crypto.subtle.deriveKey(
        { name: "ECDH", public: memberPublicKey },
        myPrivateKey,
        { name: "AES-GCM", length: 256 },
        false, ["encrypt", "decrypt"]
    );

// Hämta rummets AES-GCM-nyckel från IndexedDB
    const roomAesKey = await loadRoomKeyLocally(roomId);
// Exportera rummets AES-GCM-nyckel som raw bytes
    const rawRoomKey = await crypto.subtle.exportKey("raw", roomAesKey);
// Generera en slumpmässig IV för AES-GCM-kryptering
    const iv = crypto.getRandomValues(new Uint8Array(12));
// Kryptera rummets AES-GCM-nyckel med den nya medlemmens publika ECDH-nyckel
    const encryptedKeyBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv }, sharedSecret, rawRoomKey
    );

// Skicka den krypterade rumsnyckeln och IV till servern för lagring
    await fetch("/Chat/SaveEncryptedRoomKey", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `roomId=${roomId}&targetUserId=${encodeURIComponent(targetUserId)}&encryptedKey=${encodeURIComponent(arrayBufferToBase64(encryptedKeyBuffer))}&iv=${encodeURIComponent(arrayBufferToBase64(iv))}&__RequestVerificationToken=${encodeURIComponent(antiForgeryToken)}`
    });

    alert("Medlem tillagd och nyckel distribuerad!");
});

document.querySelectorAll(".room-badge").forEach(badge => {
    badge.addEventListener("click", async () => {
        switchGroup(badge.dataset.roomName);
    });
});

// Skapa nytt rum. Generera en ny AES-GCM-nyckel för rummet, spara den lokalt och skicka rumsnamnet till servern.
document.getElementById("createRoomForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const roomName = document.getElementById("newRoomName").value.trim();
    if (!roomName) return;

    const response = await fetch("/Chat/CreateRoom", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `roomName=${encodeURIComponent(roomName)}&__RequestVerificationToken=${encodeURIComponent(antiForgeryToken)}`
    });

    if (!response.ok) {
        alert("Kunde inte skapa rum.");
        return;
    }

// Hämta rums-ID från serverns svar och generera en ny AES-GCM-nyckel för rummet
    const result = await response.json();
    const roomAesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );

    await saveRoomKeyLocally(result.roomId, roomAesKey);

    location.reload();
});

// Initialisera appen: säkerställ att användarens ECDH-nyckelpar är registrerat på servern, 
// och starta SignalR - anslutningen.
async function initializeApp() {
    myPrivateKey = await ensureKeysRegistered();

    connection.start()
        .then(() => setConnectedUi(true))
        .catch(err => {
            console.error("Kunde inte ansluta:", err);
            setConnectedUi(false);
        });
}

initializeApp();

connection.onreconnecting(() => setConnectedUi(false));
connection.onreconnected(() => setConnectedUi(true));
connection.onclose(() => setConnectedUi(false));