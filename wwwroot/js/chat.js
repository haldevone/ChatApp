    

const connection = new signalR.HubConnectionBuilder()
    .withUrl("/chatHub")
    .withAutomaticReconnect()
    .build();

let currentGroup = null;
let currentRoomId = null;
let currentRoomKey = null;

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

const keyDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("ChatAppKeys", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

let typingTimeout = null;

async function getOrCreateKeyPair() {
    const db = await keyDbPromise;
    const tx = db.transaction("keys", "readonly");
    const existingPrivate = await new Promise(res => {
        const req = tx.objectStore("keys").get("ecdhPrivateKey");
        req.onsuccess = () => res(req.result);
    });
    const existingPublic = await new Promise(res => {
        const req = tx.objectStore("keys").get("ecdhPublicKey");
        req.onsuccess = () => res(req.result);
    });

    if (existingPrivate && existingPublic) {
        const privateKey = await crypto.subtle.importKey(
            "jwk", existingPrivate, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
        );
        return { privateKey, publicJwk: existingPublic, isNew: false };
    }

    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const writeTx = db.transaction("keys", "readwrite");
    writeTx.objectStore("keys").put(privateJwk, "ecdhPrivateKey");
    writeTx.objectStore("keys").put(publicJwk, "ecdhPublicKey");

    return { privateKey: keyPair.privateKey, publicJwk, isNew: true };
}


async function ensureKeysRegistered() {
    const result = await getOrCreateKeyPair();

    const checkResponse = await fetch(`/Chat/GetPublicKey?userName=${encodeURIComponent(currentUserName)}`);
    if (!checkResponse.ok) {
        // Servern saknar vår publika nyckel (t.ex. efter databas-rensning) — ladda upp igen
        await fetch("/Chat/SavePublicKey", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `publicKeyJwk=${encodeURIComponent(JSON.stringify(result.publicJwk))}&__RequestVerificationToken=${encodeURIComponent(antiForgeryToken)}`
        });
    }

    return result.privateKey;
}


let myPrivateKey = null;

ensureKeysRegistered().then(key => { myPrivateKey = key; });

messageInput.addEventListener("input", () => {
    if (!currentGroup) return;
    connection.invoke("NotifyTyping", currentGroup).catch(err => console.error(err));
});

const roomKeyDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("ChatAppRoomKeys", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("roomKeys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

async function saveRoomKeyLocally(roomId, aesKey) {
    const jwk = await crypto.subtle.exportKey("jwk", aesKey);
    const db = await roomKeyDbPromise;
    const tx = db.transaction("roomKeys", "readwrite");
    tx.objectStore("roomKeys").put(jwk, roomId);
}

async function loadRoomKeyLocally(roomId) {
    const db = await roomKeyDbPromise;
    const tx = db.transaction("roomKeys", "readonly");
    const jwk = await new Promise(res => {
        const req = tx.objectStore("roomKeys").get(roomId);
        req.onsuccess = () => res(req.result);
    });
    if (!jwk) return null;

    return crypto.subtle.importKey(
        "jwk", jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]
    );
}

let hideTypingTimer = null;

function setConnectedUi(isConnected) {
    statusBadge.textContent = isConnected ? "Ansluten" : "Frånkopplad";
    statusBadge.className = "status-badge " + (isConnected ? "status-connected" : "status-disconnected");
}

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

async function decryptMessage(encryptedText, iv) {
    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToArrayBuffer(iv) },
            currentRoomKey,
            base64ToArrayBuffer(encryptedText)
        );
        return new TextDecoder().decode(decrypted);
    } catch {
        return "[Kunde inte dekryptera meddelandet]";
    }
}

connection.on("ReceiveMessage", async (sender, encryptedText, iv, sentAtUtc) => {
    if (!currentRoomKey) return;

    const plaintext = await decryptMessage(encryptedText, iv);
    addMessage({ sender, text: plaintext, isOwn: sender === currentUserName, sentAt: sentAtUtc });
});

connection.on("UserJoined", (userName) => {
    addMessage({ text: `${userName} anslöt till gruppen`, isSystem: true });
});

connection.on("UserLeft", (userName) => {
    addMessage({ text: `${userName} lämnade gruppen`, isSystem: true });
});

connection.on("UserTyping", (userName) => {
	typingIndicator.textContent = `${userName} skriver...`;
	clearTimeout(hideTypingTimer);
        
	hideTypingTimer = setTimeout(() => {
		typingIndicator.textContent = "";
	}, 2000);
});

connection.on("JoinDenied", (groupName) => {
    alert(`Du har inte behörighet till rummet "${groupName}".`);
});

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

connection.on("JoinApproved", async (groupName, roomId) => {
    currentGroup = groupName;
    currentRoomId = roomId;
    groupPanel.style.display = "none";
    activeGroupBox.style.display = "flex";

    activeGroupName.textContent = "Du är i grupp: ";
    const boldName = document.createElement("span");
    boldName.style.fontWeight = "700";
    boldName.style.textTransform = "uppercase";
    boldName.textContent = groupName;
    activeGroupName.appendChild(boldName);

    messageInput.disabled = false;
    sendBtn.disabled = false;
    groupInput.value = "";

    currentRoomKey = await loadRoomKeyLocally(roomId);
    console.log("Lokal nyckel:", currentRoomKey);

    if (!currentRoomKey) {
        const response = await fetch(`/Chat/GetMyEncryptedRoomKey?roomId=${roomId}`);
        console.log("GetMyEncryptedRoomKey status:", response.status);
        if (!response.ok) {
            alert("Kunde inte hämta rumsnyckel.");
            return;
        }
        const { encryptedKey, iv, ownerPublicKey } = await response.json();
        console.log("Fick från servern:", { encryptedKey, iv, ownerPublicKey });

        // ... resten oförändrat, men lägg en catch runt dekrypteringen:
        try {
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
            console.log("Dekryptering lyckades, nyckel satt");
        } catch (err) {
            console.error("Dekryptering av rumsnyckel misslyckades:", err);
        }
    }
});

connection.on("JoinDenied", (groupName) => {
    alert(`Du har inte behörighet till rummet "${groupName}".`);
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

// sendBtn.addEventListener("click", sendMessage);
    
// messageInput.addEventListener("keydown", (e) => {

//     if (e.key === "Enter") sendMessage();
// });
sendBtn.addEventListener("click", () => {
    sendMessage();
});

async function sendMessage() {

    const text = messageInput.value.trim();

    if (!text || !currentGroup || !currentRoomKey) return;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv }, currentRoomKey, encoded
    );

    console.log("ciphertext:", ciphertext, "byteLength:", ciphertext.byteLength);
    console.log("iv:", iv, "length:", iv.length);
    const ciphertextB64 = arrayBufferToBase64(ciphertext);
    const ivB64 = arrayBufferToBase64(iv);

    console.log("ciphertextB64:", ciphertextB64);
    console.log("ivB64:", ivB64);

    await connection.invoke(
        "SendMessageToGroup",
        currentGroup,
        arrayBufferToBase64(ciphertext),
        arrayBufferToBase64(iv)
    );
    messageInput.value = "";
}


document.getElementById("addMemberForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const roomId = Number(document.getElementById("addMemberRoomId").value);
    const userName = document.getElementById("addMemberUserName").value.trim();
    if (!roomId || !userName) return;

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

    // Hämta nya medlemmens publika ECDH-nyckel
    const keyResponse = await fetch(`/Chat/GetPublicKey?userName=${encodeURIComponent(userName)}`);
    if (!keyResponse.ok) {
        alert("Medlem tillagd, men saknar publik nyckel (har inte loggat in i chatten än).");
        return;
    }
    const { publicKey } = await keyResponse.json();
    const memberPublicKey = await crypto.subtle.importKey(
        "jwk", JSON.parse(publicKey), { name: "ECDH", namedCurve: "P-256" }, true, []
    );

    // Härled delad hemlighet: min privata + deras publika
    const sharedSecret = await crypto.subtle.deriveKey(
        { name: "ECDH", public: memberPublicKey },
        myPrivateKey,
        { name: "AES-GCM", length: 256 },
        false, ["encrypt", "decrypt"]
    );

    // Kryptera rumsnyckeln med den delade hemligheten
    const roomAesKey = await loadRoomKeyLocally(roomId);
    const rawRoomKey = await crypto.subtle.exportKey("raw", roomAesKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedKeyBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv }, sharedSecret, rawRoomKey
    );

    // Behöver mottagarens userId, inte bara username — hämta via AddMember-svaret istället
    await fetch("/Chat/SaveEncryptedRoomKey", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `roomId=${roomId}&targetUserId=${encodeURIComponent(targetUserId)}&encryptedKey=${encodeURIComponent(arrayBufferToBase64(encryptedKeyBuffer))}&iv=${encodeURIComponent(arrayBufferToBase64(iv))}&__RequestVerificationToken=${encodeURIComponent(antiForgeryToken)}`
    });

    alert("Medlem tillagd och nyckel distribuerad!");
});

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

document.querySelectorAll(".room-badge").forEach(badge => {
    badge.addEventListener("click", async () => {
        switchGroup(badge.dataset.roomName);
    });
});

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

    const result = await response.json();
    const roomAesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );

    await saveRoomKeyLocally(result.roomId, roomAesKey);

    location.reload();
});

connection.start()
    .then(() => setConnectedUi(true))
    .catch(err => {
        console.error("Kunde inte ansluta:", err);
        setConnectedUi(false);
    });

connection.onreconnecting(() => setConnectedUi(false));
connection.onreconnected(() => setConnectedUi(true));
connection.onclose(() => setConnectedUi(false));