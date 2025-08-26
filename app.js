// app.js (module)
// Firebase imports (v10 modular)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    getFirestore, collection, doc, setDoc, getDoc, addDoc, query, orderBy,
    limit, onSnapshot, serverTimestamp, updateDoc, deleteDoc, increment, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

// --------- CONFIG (তোমার Firebase config এখানে) ----------
const firebaseConfig = {
    apiKey: "AIzaSyAatiY08DpbdqK6pAE53OWkQOJZJYTZbdI",
    authDomain: "social-app-f4758.firebaseapp.com",
    projectId: "social-app-f4758",
    storageBucket: "social-app-f4758.appspot.com",
    messagingSenderId: "381586413963",
    appId: "1:381586413963:web:2cead65d0b849aa277378e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

// ---------- App state ----------
const state = {
    user: null,
    currentRoute: 'feed',
    posts: [],
    postReactions: {},
    postComments: {},
    chatMessages: [],
    currentChatRoom: 'general',
    replyTo: null,
    isLoading: false,
    unsubscribers: []
};

// ---------- Utils ----------
const formatTime = (timestamp) => {
    if (!timestamp) return 'now';
    if (timestamp.seconds) return dayjs.unix(timestamp.seconds).fromNow();
    try { return dayjs(timestamp).fromNow(); } catch(e){ return 'now'; }
};

const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

const showNotification = (message) => {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.innerHTML = `
        <div class="flex items-center gap-2">
            <div class="flex-1">${escapeHtml(message)}</div>
            <button class="text-white hover:text-gray-300 text-xl">×</button>
        </div>
    `;
    notification.querySelector('button').onclick = () => notification.remove();
    document.getElementById('notifications').appendChild(notification);
    setTimeout(()=>notification.classList.add('show'), 50);
    setTimeout(()=>{ notification.classList.remove('show'); setTimeout(()=>notification.remove(),300); }, 4500);
};

// ---------- Auth handlers ----------
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.user = user;
        await createUserProfile(user); // ensure profile doc
        teardownListeners();
        setupPostsListener();
        if (state.currentRoute === 'chat') setupChatListener();
    } else {
        state.user = null;
        teardownListeners();
        state.posts = [];
        state.chatMessages = [];
    }
    render();
});

const handleGoogleLogin = async () => {
    try {
        state.isLoading = true; render();
        const res = await signInWithPopup(auth, googleProvider);
        await createUserProfile(res.user);
        showNotification('Signed in with Google');
    } catch (err) {
        console.error(err); showNotification('Google sign-in failed');
    } finally { state.isLoading = false; render(); }
};

const handleEmailAuth = async (email, password, isSignup=false, displayName='') => {
    try {
        state.isLoading = true; render();
        let res;
        if (isSignup) {
            res = await createUserWithEmailAndPassword(auth, email, password);
            if (displayName) await updateProfile(res.user, { displayName });
            await createUserProfile(res.user);
            showNotification('Account created');
        } else {
            res = await signInWithEmailAndPassword(auth, email, password);
            showNotification('Signed in');
        }
    } catch (err) {
        console.error(err); showNotification(err.message || 'Auth error');
    } finally { state.isLoading = false; render(); }
};

const handleLogout = async () => {
    try {
        state.unsubscribers.forEach(u => u && typeof u === 'function' && u());
        state.unsubscribers = [];
        await signOut(auth);
        state.user = null;
        state.posts = [];
        state.chatMessages = [];
        state.currentRoute = 'feed';
        showNotification('Signed out');
        render();
    } catch (err) { console.error(err); showNotification('Failed to sign out'); }
};

// ---------- Create / ensure user profile in Firestore ----------
const createUserProfile = async (user) => {
    try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
            await setDoc(userRef, {
                uid: user.uid,
                name: user.displayName || user.email?.split('@')[0] || 'User',
                email: user.email || null,
                avatar: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=1DB954&color=000`,
                bio: 'New to Glassy Social! 🌟',
                following: [],
                followers: [],
                postsCount: 0,
                createdAt: serverTimestamp(),
                lastActive: serverTimestamp(),
                role: 'user'
            });
        } else {
            await updateDoc(userRef, { lastActive: serverTimestamp() });
        }
    } catch (err) { console.error('createUserProfile error', err); }
};

// ---------- Posts: create, delete, report ----------
const createPost = async (text, imageFile=null) => {
    if (!state.user) { showNotification('Please sign in'); return; }
    if (!text.trim() && !imageFile) { showNotification('Post is empty'); return; }

    try {
        state.isLoading = true; render();
        let imageUrl = '';
        let imagePath = '';
        if (imageFile) {
            const path = `posts/${state.user.uid}/${Date.now()}_${imageFile.name}`;
            const ref = storageRef(storage, path);
            const snap = await uploadBytes(ref, imageFile);
            imageUrl = await getDownloadURL(snap.ref);
            imagePath = path;
        }

        const postData = {
            authorId: state.user.uid,
            authorName: state.user.displayName || 'User',
            authorAvatar: state.user.photoURL || '',
            text: text.trim(),
            imageUrl,
            imagePath,
            commentsCount: 0,
            reactionsCount: 0,
            visibility: 'public',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        const pRef = await addDoc(collection(db, 'posts'), postData);
        const uRef = doc(db, 'users', state.user.uid);
        await updateDoc(uRef, { postsCount: increment(1) });

        showNotification('Post created');
        const t = document.getElementById('postText'); if (t) t.value = '';
        const f = document.getElementById('postImage'); if (f) f.value = '';
    } catch (err) {
        console.error(err);
        showNotification('Failed to create post');
    } finally { state.isLoading = false; render(); }
};

const deletePost = async (postId, postData = null) => {
    if (!state.user) return;
    try {
        const pRef = doc(db, 'posts', postId);
        const snap = await getDoc(pRef);
        if (!snap.exists()) { showNotification('Post not found'); return; }
        const data = postData || snap.data();
        if (data.authorId !== state.user.uid) { showNotification('Not authorized'); return; }

        if (data.imagePath) {
            try { await deleteObject(storageRef(storage, data.imagePath)); } catch(e){ /* ignore */ }
        }
        await deleteDoc(pRef);
        const uRef = doc(db, 'users', state.user.uid);
        await updateDoc(uRef, { postsCount: increment(-1) });

        showNotification('Post deleted');
    } catch (err) {
        console.error(err); showNotification('Failed to delete');
    }
};

const reportPost = async (postId, reason='') => {
    if (!state.user) { showNotification('Please sign in'); return; }
    try {
        await addDoc(collection(db, 'reports'), {
            postId,
            reporterId: state.user.uid,
            reason,
            createdAt: serverTimestamp()
        });
        showNotification('Post reported — thank you');
    } catch (err) { console.error(err); showNotification('Failed to report'); }
};

// ---------- Reactions ----------
const toggleReaction = async (postId, reactionType) => {
    if (!state.user) { showNotification('Please sign in'); return; }
    try {
        const reactionRef = doc(db, 'posts', postId, 'reactions', state.user.uid);
        const reactionSnap = await getDoc(reactionRef);
        if (reactionSnap.exists() && reactionSnap.data().type === reactionType) {
            await deleteDoc(reactionRef);
            await updateDoc(doc(db, 'posts', postId), { reactionsCount: increment(-1) });
        } else {
            await setDoc(reactionRef, {
                type: reactionType,
                userId: state.user.uid,
                createdAt: serverTimestamp()
            });
            await updateDoc(doc(db, 'posts', postId), { reactionsCount: increment(1) });
        }
    } catch (err) { console.error(err); showNotification('Failed to react'); }
};

// ---------- Comments ----------
const addComment = async (postId, content) => {
    if (!state.user || !content.trim()) return false;
    try {
        await addDoc(collection(db, 'posts', postId, 'comments'), {
            authorId: state.user.uid,
            authorName: state.user.displayName || 'User',
            authorAvatar: state.user.photoURL || '',
            content: content.trim(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        await updateDoc(doc(db, 'posts', postId), { commentsCount: increment(1) });
        showNotification('Comment added');
        const input = document.getElementById(`comment-${postId}`); if (input) input.value = '';
        return true;
    } catch (err) { console.error(err); showNotification('Failed to add comment'); return false; }
};

// ---------- Chat ----------
const sendMessage = async (content, roomId = 'general') => {
    if (!state.user || !content.trim()) return false;
    try {
        await addDoc(collection(db, 'chats', roomId, 'messages'), {
            senderId: state.user.uid,
            senderName: state.user.displayName || 'User',
            senderAvatar: state.user.photoURL || '',
            content: content.trim(),
            roomId,
            replyTo: state.replyTo || null,
            timestamp: serverTimestamp(),
            readBy: { [state.user.uid]: true },
            editedAt: null
        });
        state.replyTo = null;
        const messageInput = document.getElementById('messageInput'); if (messageInput) messageInput.value = '';
        render();
        setTimeout(()=>{ const mc = document.getElementById('messagesContainer'); if(mc) mc.scrollTop = mc.scrollHeight; }, 100);
        return true;
    } catch (err) { console.error(err); showNotification('Failed to send'); return false; }
};

const setReplyTo = (message) => {
    state.replyTo = { id: message.id, content: message.content, senderName: message.senderName };
    render();
    const mi = document.getElementById('messageInput'); if (mi) mi.focus();
};
const clearReply = ()=>{ state.replyTo = null; render(); };

// ---------- Real-time listeners ----------
const setupPostsListener = () => {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snapshot) => {
        state.posts = snapshot.docs.map(d=>({ id: d.id, ...d.data() }));
        state.posts.forEach(p => {
            setupPostReactionsListener(p.id);
            setupPostCommentsListener(p.id);
        });
        if (state.currentRoute === 'feed') render();
    }, (err)=>{ console.error('posts listener err',err); });
    state.unsubscribers.push(unsub);
};

const setupPostReactionsListener = (postId) => {
    const q = query(collection(db,'posts',postId,'reactions'));
    const unsub = onSnapshot(q, (snapshot)=>{
        const reactions = {};
        let userReaction = null;
        snapshot.docs.forEach(docu=>{
            const rx = docu.data();
            reactions[rx.type] = (reactions[rx.type]||0) + 1;
            if (docu.id === state.user?.uid) userReaction = rx.type;
        });
        state.postReactions[postId] = { reactions, userReaction };
        if (state.currentRoute === 'feed') render();
    });
    state.unsubscribers.push(unsub);
};

const setupPostCommentsListener = (postId) => {
    const q = query(collection(db,'posts',postId,'comments'), orderBy('createdAt','asc'));
    const unsub = onSnapshot(q, (snapshot)=>{
        state.postComments[postId] = snapshot.docs.map(d=>({ id:d.id, ...d.data() }));
        if (state.currentRoute === 'feed') render();
    });
    state.unsubscribers.push(unsub);
};

const setupChatListener = () => {
    const q = query(collection(db,'chats', state.currentChatRoom, 'messages'), orderBy('timestamp','asc'), limit(200));
    const unsub = onSnapshot(q, (snapshot)=>{
        state.chatMessages = snapshot.docs.map(d=>({ id:d.id, ...d.data() }));
        if (state.currentRoute === 'chat') {
            render();
            setTimeout(()=>{ const mc = document.getElementById('messagesContainer'); if(mc) mc.scrollTop = mc.scrollHeight; },100);
        }
    });
    state.unsubscribers.push(unsub);
};

const teardownListeners = () => {
    state.unsubscribers.forEach(u => u && typeof u === 'function' && u());
    state.unsubscribers = [];
};

// ---------- Navigation & render ----------
const navigate = (route) => {
    state.currentRoute = route;
    window.history.pushState({}, '', `#${route}`);
    if (route === 'chat' && state.user) setupChatListener();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ---------- Helper DOM event handlers referenced from templates ----------
window.handleAuthSubmit = (e) => {
    e.preventDefault();
    const action = e.submitter?.value || (new FormData(e.target)).get('action');
    const displayName = document.getElementById('displayName')?.value || '';
    const email = document.getElementById('email')?.value || '';
    const password = document.getElementById('password')?.value || '';
    if (action === 'signup') handleEmailAuth(email, password, true, displayName);
    else handleEmailAuth(email, password, false);
};

window.handleCreatePost = () => {
    const text = document.getElementById('postText')?.value || '';
    const fileEl = document.getElementById('postImage');
    const file = fileEl && fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;
    createPost(text, file);
};

window.handleAddComment = (postId) => {
    const input = document.getElementById(`comment-${postId}`);
    if (!input) return;
    addComment(postId, input.value || '');
};

window.handleCommentKeyPress = (e, postId) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addComment(postId, e.target.value || '');
    }
};

window.deletePost = (postId) => {
    if (!confirm('Delete this post?')) return;
    const p = state.posts.find(x => x.id === postId);
    deletePost(postId, p);
};

window.reportPost = (postId) => {
    const reason = prompt('Why are you reporting this post? (optional)');
    reportPost(postId, reason || '');
};

window.toggleReaction = (postId, emoji) => toggleReaction(postId, emoji);

window.sendMessageFromUI = () => {
    const val = document.getElementById('messageInput')?.value || '';
    sendMessage(val, state.currentChatRoom);
};

window.openProfile = (uid) => {
    state.currentRoute = `profile:${uid}`;
    render();
};

// ---------- Render functions (same layout as before) ----------
// For brevity, reuse same render functions as single-file version but adapted to module scope.

const renderNavbar = () => `
    <nav class="glass p-4 mb-6">
        <div class="max-w-6xl mx-auto flex items-center justify-between">
            <div class="flex items-center space-x-3">
                <div class="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-black font-bold">GS</div>
                <div>
                    <h1 class="text-xl font-bold">Glassy Social</h1>
                    <p class="text-sm text-gray-400">Complete Social Platform</p>
                </div>
            </div>
            <div class="flex items-center space-x-4">
                ${state.user ? `
                    <button onclick="navigate('feed')" class="btn ${state.currentRoute === 'feed' ? 'btn-primary' : 'btn-ghost'}">📱 Feed</button>
                    <button onclick="navigate('chat')" class="btn ${state.currentRoute === 'chat' ? 'btn-primary' : 'btn-ghost'}">💬 Chat</button>
                    <button onclick="navigate('profile:${state.user.uid}')" class="btn ${state.currentRoute.startsWith('profile') ? 'btn-primary' : 'btn-ghost'}">👤 Profile</button>
                    <button onclick="handleLogout()" class="btn btn-ghost">🚪 Logout</button>
                ` : `
                    <button onclick="navigate('login')" class="btn btn-primary">🚀 Get Started</button>
                `}
            </div>
        </div>
    </nav>
`;

const renderLogin = () => `
    <div class="max-w-md mx-auto">
        <div class="glass p-8">
            <div class="text-center mb-6">
                <h2 class="text-2xl font-bold mb-2">Welcome to Glassy Social</h2>
                <p class="text-gray-400">Connect, share, and chat with friends</p>
            </div>
            <div class="space-y-4">
                <button onclick="handleGoogleLogin()" class="btn btn-secondary w-full">🚀 Continue with Google</button>
                <div class="text-center text-gray-400">or</div>
                <form id="authForm" class="space-y-4" onsubmit="handleAuthSubmit(event)">
                    <input id="displayName" type="text" placeholder="Display Name (for signup)" class="input">
                    <input id="email" type="email" placeholder="Email" class="input" required>
                    <input id="password" type="password" placeholder="Password" class="input" required>
                    <div class="flex gap-2">
                        <button type="submit" name="action" value="login" class="btn btn-primary flex-1">Login</button>
                        <button type="submit" name="action" value="signup" class="btn btn-ghost flex-1">Sign Up</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
`;

const renderPostComposer = () => {
    if (!state.user) return '';
    return `
        <div class="glass p-6 mb-6 max-w-2xl mx-auto">
            <div class="flex items-start space-x-4">
                <img src="${state.user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(state.user.displayName||'User')}&background=1DB954&color=000`}" class="w-12 h-12 rounded-full object-cover">
                <div class="flex-1">
                    <textarea id="postText" placeholder="What's on your mind?" class="input resize-none w-full" rows="3"></textarea>
                    <div class="flex items-center justify-between mt-4">
                        <input id="postImage" type="file" accept="image/*" class="text-sm text-gray-400">
                        <button onclick="handleCreatePost()" class="btn btn-primary">${state.isLoading ? '<span class="loader"></span>' : '📝 Post'}</button>
                    </div>
                </div>
            </div>
        </div>
    `;
};

const renderPost = (post) => {
    const reactionsObj = state.postReactions[post.id] || { reactions: {}, userReaction: null };
    const comments = state.postComments[post.id] || [];
    const emojis = ['👍','❤','😂','😮','😢'];
    return `
        <div class="glass p-6 mb-6 max-w-2xl mx-auto">
            <div class="flex items-start space-x-4">
                <img src="${post.authorAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.authorName||'User')}&background=1DB954&color=000`}" class="w-12 h-12 rounded-full object-cover">
                <div class="flex-1">
                    <div class="flex items-center justify-between">
                        <div>
                            <h3 class="font-semibold cursor-pointer" onclick="openProfile('${post.authorId}')">${escapeHtml(post.authorName||'User')}</h3>
                            <p class="text-sm text-gray-400">${formatTime(post.createdAt)}</p>
                        </div>
                        <div>
                            ${post.authorId === state.user?.uid ? `<button onclick="deletePost('${post.id}')" class="text-red-400 hover:text-red-300">🗑️</button>` : `<button onclick="reportPost('${post.id}')" class="text-yellow-400 hover:text-yellow-300">⚠️</button>`}
                        </div>
                    </div>

                    <div class="mt-3">
                        <p class="whitespace-pre-wrap">${escapeHtml(post.text || '')}</p>
                        ${post.imageUrl ? `<img src="${post.imageUrl}" class="mt-3 rounded-lg max-w-full h-auto">` : ''}
                    </div>

                    <div class="flex items-center space-x-2 mt-4">
                        ${emojis.map(emoji => `
                            <button onclick="toggleReaction('${post.id}','${emoji}')" class="reaction-btn ${reactionsObj.userReaction === emoji ? 'active' : ''}">
                                ${emoji} <span class="ml-1 text-sm">${reactionsObj.reactions[emoji] || 0}</span>
                            </button>
                        `).join('')}
                        <div class="text-sm text-gray-400 ml-3">${post.reactionsCount || 0} reactions • ${post.commentsCount || 0} comments</div>
                    </div>

                    <div class="mt-4 border-t border-gray-700 pt-4">
                        <div class="space-y-3 max-h-48 overflow-y-auto">
                            ${comments.map(c => `
                                <div class="flex items-start space-x-3">
                                    <img src="${c.authorAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.authorName||'User')}&background=1DB954&color=000`}" class="w-8 h-8 rounded-full object-cover">
                                    <div class="flex-1">
                                        <div class="bg-gray-800 rounded-lg p-3">
                                            <div class="flex items-center justify-between">
                                                <div>
                                                    <span class="font-semibold text-sm">${escapeHtml(c.authorName||'User')}</span>
                                                    <span class="text-xs text-gray-400 ml-2">${formatTime(c.createdAt)}</span>
                                                </div>
                                            </div>
                                            <p class="text-sm mt-1">${escapeHtml(c.content||'')}</p>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>

                        <div class="flex items-center space-x-3 mt-3">
                            <img src="${state.user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(state.user.displayName||'User')}&background=1DB954&color=000`}" class="w-8 h-8 rounded-full object-cover">
                            <input id="comment-${post.id}" placeholder="Write a comment..." class="input flex-1" onkeypress="handleCommentKeyPress(event,'${post.id}')">
                            <button onclick="handleAddComment('${post.id}')" class="btn btn-ghost">💬</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
};

const renderFeed = () => `
    <div>
        ${renderPostComposer()}
        <div class="space-y-6">
            ${state.posts.length ? state.posts.map(renderPost).join('') : `
                <div class="glass p-8 text-center max-w-2xl mx-auto">
                    <h3 class="text-xl font-semibold mb-2">Welcome to Glassy Social!</h3>
                    <p class="text-gray-400">No posts yet. Be the first to share something amazing! 🎉</p>
                </div>
            `}
        </div>
    </div>
`;

const renderChat = () => {
    if (!state.user) return `<div class="max-w-2xl mx-auto glass p-6 text-center">Please login to use chat</div>`;
    return `
        <div class="max-w-2xl mx-auto">
            <div class="glass p-4 mb-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <h2 class="text-lg font-semibold">Chat — ${escapeHtml(state.currentChatRoom)}</h2>
                        <div class="text-sm text-gray-400">${state.chatMessages.length} messages</div>
                    </div>
                    <div>
                        <button onclick="navigate('feed')" class="btn btn-ghost">Back to feed</button>
                    </div>
                </div>
            </div>

            <div id="messagesContainer" class="glass p-4 mb-4 max-h-96 overflow-y-auto">
                ${state.chatMessages.map(m=>{
                    const isOwn = m.senderId === state.user.uid;
                    return `
                        <div class="flex ${isOwn ? 'justify-end' : 'justify-start'} mb-4">
                            <div class="message ${isOwn ? 'own' : 'other'}">
                                ${m.replyTo ? `<div class="text-xs opacity-75">Replying to ${escapeHtml(m.replyTo.senderName||'User')}: ${escapeHtml(m.replyTo.content||'')}</div>` : ''}
                                <div class="text-sm font-semibold">${escapeHtml(m.senderName||'User')}</div>
                                <div class="mt-1">${escapeHtml(m.content||'')}</div>
                                <div class="text-xs text-gray-400 mt-2">${formatTime(m.timestamp)}</div>
                                ${!isOwn ? `<div class="mt-2"><button onclick='setReplyTo(${JSON.stringify({ id: m.id, content: m.content, senderName: m.senderName })})' class="btn btn-ghost btn-sm">Reply</button></div>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>

            <div class="glass p-4 flex items-start gap-3">
                ${state.replyTo ? `<div class="p-2 bg-gray-800 rounded w-full"><div class="text-xs">Replying to <strong>${escapeHtml(state.replyTo.senderName)}</strong>: ${escapeHtml(state.replyTo.content)}</div><div class="text-right"><button onclick="clearReply()" class="btn btn-ghost btn-sm">Clear</button></div></div>` : ''}
                <input id="messageInput" class="input flex-1" placeholder="Type a message..." />
                <button onclick="sendMessageFromUI()" class="btn btn-primary">Send</button>
            </div>
        </div>
    `;
};

const renderProfile = (uid) => {
    let profileHtml = '';
    if (!uid || uid === (state.user && state.user.uid)) {
        profileHtml = `
            <div class="max-w-2xl mx-auto">
                <div class="glass p-6 mb-6">
                    <div class="flex items-center gap-4">
                        <img src="${state.user?.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(state.user?.displayName||'User')}&background=1DB954&color=000`}" class="w-20 h-20 rounded-full object-cover">
                        <div>
                            <h2 class="text-xl font-semibold">${escapeHtml(state.user?.displayName || 'User')}</h2>
                            <p class="text-gray-400">${escapeHtml(state.user?.email || '')}</p>
                            <p class="mt-2 text-sm text-gray-300">This is your profile. More features (edit bio, follow, uploads) can be added.</p>
                        </div>
                    </div>
                </div>

                <div class="glass p-6">
                    <h3 class="font-semibold mb-3">Your recent posts</h3>
                    ${state.posts.filter(p=>p.authorId === state.user?.uid).map(renderPost).join('')}
                </div>
            </div>
        `;
    } else {
        profileHtml = `<div class="max-w-2xl mx-auto glass p-6 text-center">Loading profile...</div>`;
        (async () => {
            try {
                const uRef = doc(db, 'users', uid);
                const uSnap = await getDoc(uRef);
                if (uSnap.exists()) {
                    const data = uSnap.data();
                    state.currentRoute = `profile:${uid}`;
                    document.getElementById('app').innerHTML = renderNavbar() + `
                        <main>
                            <div class="max-w-2xl mx-auto">
                                <div class="glass p-6 mb-6">
                                    <div class="flex items-center gap-4">
                                        <img src="${data.avatar}" class="w-20 h-20 rounded-full object-cover">
                                        <div>
                                            <h2 class="text-xl font-semibold">${escapeHtml(data.name || 'User')}</h2>
                                            <p class="text-gray-400">${escapeHtml(data.email || '')}</p>
                                            <p class="mt-2 text-sm text-gray-300">${escapeHtml(data.bio || '')}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </main>
                    `;
                } else {
                    showNotification('User not found');
                    navigate('feed');
                }
            } catch (e) {
                console.error(e);
                showNotification('Failed to load profile');
                navigate('feed');
            }
        })();
    }
    return profileHtml;
};

const renderApp = () => {
    const nav = renderNavbar();
    let main = '';
    if (!state.user && state.currentRoute === 'login') {
        main = renderLogin();
    } else if (!state.user && state.currentRoute !== 'login') {
        main = `<div class="max-w-2xl mx-auto glass p-6 text-center"><h3 class="text-lg font-semibold">Please sign in to see the feed</h3><div class="mt-4"><button onclick="navigate('login')" class="btn btn-primary">Sign in / Sign up</button></div></div>`;
    } else {
        if (state.currentRoute === 'feed') main = renderFeed();
        else if (state.currentRoute === 'chat') main = renderChat();
        else if (state.currentRoute.startsWith('profile')) {
            const parts = state.currentRoute.split(':');
            const uid = parts[1] || state.user.uid;
            main = renderProfile(uid);
        } else if (state.currentRoute === 'login') main = renderLogin();
        else main = renderFeed();
    }

    return `
        <div class="max-w-6xl mx-auto">
            ${nav}
            <main>${main}</main>
        </div>
    `;
};

const render = () => {
    document.getElementById('app').innerHTML = renderApp();
};

// initial render
render();

// handle back/forward browser buttons
window.onpopstate = () => {
    const hash = window.location.hash.replace('#','');
    if (hash) state.currentRoute = hash;
    render();
};
