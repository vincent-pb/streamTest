class AIAgentDemo {
    constructor() {
        this.currentProtocol = 'sse';
        this.sseEventSource = null;
        this.websocket = null;
        this.isConnected = false;
        this.currentResponseElement = null;
        this.responseTime = null;
        
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.questionInput = document.getElementById('questionInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.chatMessages = document.getElementById('chatMessages');
        this.statusElement = document.getElementById('status');
        this.protocolBtns = document.querySelectorAll('.protocol-btn');
    }

    bindEvents() {
        this.sendBtn.addEventListener('click', () => this.sendQuestion());
        this.questionInput.addEventListener('keypress', (e) => this.handleKeyPress(e));
    }

    switchProtocol(protocol) {
        this.currentProtocol = protocol;
        
        // Update button states
        this.protocolBtns.forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        
        // Disconnect current connection
        this.disconnect();
        
        // Update status
        this.updateStatus('connecting', `Connecting to AI agent via ${protocol.toUpperCase()}...`);
        
        // Test connection immediately
        this.testConnection();
    }

    testConnection() {
        if (this.currentProtocol === 'sse') {
            // For SSE, we'll test by making a simple request
            this.testSSEConnection();
        } else if (this.currentProtocol === 'websocket') {
            // For WebSocket, establish connection immediately
            this.connectWebSocket();
        } else if (this.currentProtocol === 'nostream') {
            // For No-Stream, test the endpoint
            this.testNoStreamConnection();
        }
    }

    async testSSEConnection() {
        try {
            const response = await fetch('/ai/test', {
                method: 'GET'
            });
            
            if (response.ok) {
                this.updateStatus('connected', 'Connected to AI agent (SSE ready)');
            } else {
                this.updateStatus('disconnected', 'Failed to connect to AI agent');
            }
        } catch (error) {
            console.error('SSE connection test failed:', error);
            this.updateStatus('disconnected', 'Failed to connect to AI agent');
        }
    }

    async testNoStreamConnection() {
        try {
            const response = await fetch('/ai/test', {
                method: 'GET'
            });
            
            if (response.ok) {
                this.updateStatus('connected', 'Connected to AI agent (No-Stream ready)');
            } else {
                this.updateStatus('disconnected', 'Failed to connect to AI agent');
            }
        } catch (error) {
            console.error('No-Stream connection test failed:', error);
            this.updateStatus('disconnected', 'Failed to connect to AI agent');
        }
    }

    handleKeyPress(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendQuestion();
        }
    }

    async sendQuestion() {
        const question = this.questionInput.value.trim();
        if (!question) return;

        // Add user message to chat
        this.addMessage(question, 'user');
        
        // Clear input
        this.questionInput.value = '';
        
        // Create AI response element
        this.currentResponseElement = this.addMessage('', 'ai');
        this.currentResponseElement.classList.add('typing');
        
        // Add streaming indicator
        this.addStreamingIndicator();
        
        // Start response time tracking
        this.responseStartTime = performance.now();
        this.firstLetterReceived = false;
        this.responseTime = null;
        
        // Send question based on protocol
        if (this.currentProtocol === 'sse') {
            this.sendQuestionSSE(question);
        } else if (this.currentProtocol === 'websocket') {
            this.sendQuestionWebSocket(question);
        } else if (this.currentProtocol === 'nostream') {
            this.sendQuestionNoStream(question);
        }
    }

    async sendQuestionSSE(question) {
        try {
            this.updateStatus('connecting', 'Connecting to AI agent...');
            
            const response = await fetch('/ai/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ question: question })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.updateStatus('connected', 'Connected to AI agent');
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        
                        if (data === '[END]') {
                            this.finishResponse();
                            return;
                        } else if (data.startsWith('[ERROR]')) {
                            this.showError(data.slice(8));
                            return;
                        } else if (data.startsWith('[TIMING]')) {
                            const timing = data.slice(9);
                            this.showTiming(parseFloat(timing));
                        } else if (data.startsWith('[RESPONSE_TIME]')) {
                            const responseTime = data.slice(15);
                            this.responseTime = parseFloat(responseTime);
                        } else {
                            // Track first letter received
                            if (!this.firstLetterReceived && data.trim() !== '') {
                                this.firstLetterReceived = true;
                                const responseTime = (performance.now() - this.responseStartTime) / 1000;
                                this.responseTime = responseTime;
                            }
                            this.appendToResponse(data);
                        }
                    }
                }
            }
            
        } catch (error) {
            console.error('SSE Error:', error);
            this.showError(`Connection failed: ${error.message}`);
        }
    }

    sendQuestionWebSocket(question) {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            this.connectWebSocket();
        }
        
        // Wait for connection to be established
        setTimeout(() => {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({
                    type: 'question',
                    content: question
                }));
            } else {
                this.showError('WebSocket connection failed');
            }
        }, 100);
    }

    async sendQuestionNoStream(question) {
        try {
            this.updateStatus('connecting', 'Sending question to AI agent...');
            
            const response = await fetch('/ai/nostream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ question: question })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.updateStatus('connected', 'Connected to AI agent');
            
            const data = await response.json();
            
            if (data.error) {
                this.showError(data.error);
                return;
            }
            
            // Display the complete response word by word with typing effect
            if (this.currentResponseElement && data.response) {
                // Store response time if provided by backend
                if (data.response_time) {
                    this.responseTime = parseFloat(data.response_time);
                }
                this.displayResponseWordByWord(data.response, data.timing);
            }
            
        } catch (error) {
            console.error('No-Stream Error:', error);
            this.showError(`Request failed: ${error.message}`);
        }
    }

    displayResponseWordByWord(fullResponse, timing) {
        if (!this.currentResponseElement) return;
        
        // Remove streaming indicator
        const indicator = this.currentResponseElement.querySelector('#streaming-indicator');
        if (indicator) {
            indicator.remove();
        }
        
        // Start timing for visual display
        const displayStartTime = performance.now();
        
        // Split the response into words
        const words = this.splitIntoWords(fullResponse);
        let currentIndex = 0;
        
        // Function to add next word
        const addNextWord = () => {
            if (currentIndex < words.length && this.currentResponseElement) {
                // Track first letter received
                if (!this.firstLetterReceived && words[currentIndex].trim() !== '') {
                    this.firstLetterReceived = true;
                    const responseTime = (performance.now() - this.responseStartTime) / 1000;
                    this.responseTime = responseTime;
                }
                
                this.currentResponseElement.textContent += words[currentIndex];
                this.scrollToBottom();
                currentIndex++;
                
                // Continue with next word after a short delay
                setTimeout(addNextWord, 10); // 10ms delay between words (fast, close to real streaming speed)
            } else {
                // Finished displaying all words
                const displayEndTime = performance.now();
                const displayDuration = (displayEndTime - displayStartTime) / 1000; // Convert to seconds
                
                console.log(`No-Stream Timing Breakdown:`);
                console.log(`  • Backend processing: ${timing.toFixed(2)}s`);
                console.log(`  • Visual display effect: ${displayDuration.toFixed(2)}s`);
                console.log(`  • Total time: ${(parseFloat(timing) + displayDuration).toFixed(2)}s`);
                
                // Show both backend and frontend timing information BEFORE finishing
                console.log(`Calling showDetailedTiming with: backend=${parseFloat(timing)}, display=${displayDuration}`);
                this.showDetailedTiming(parseFloat(timing), displayDuration);
                
                // Then finish the response
                this.finishResponse();
            }
        };
        
        // Start the word-by-word display
        addNextWord();
    }

    splitIntoWords(text) {
        // Simple word splitting that preserves punctuation
        const words = [];
        let currentWord = '';
        
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            
            if (char === ' ' || char === '.' || char === ',' || char === '!' || char === '?' || char === ':' || char === ';') {
                if (currentWord !== '') {
                    words.push(currentWord + char);
                    currentWord = '';
                } else {
                    words.push(char);
                }
            } else {
                currentWord += char;
            }
        }
        
        if (currentWord !== '') {
            words.push(currentWord);
        }
        
        return words;
    }

    connectWebSocket() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ai/ws`;
            
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                this.updateStatus('connected', 'Connected to AI agent (WebSocket ready)');
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    
                    if (message.type === 'word') {
                        // Track first letter received
                        if (!this.firstLetterReceived && message.content.trim() !== '') {
                            this.firstLetterReceived = true;
                            const responseTime = (performance.now() - this.responseStartTime) / 1000;
                            this.responseTime = responseTime;
                        }
                        this.appendToResponse(message.content);
                    } else if (message.type === 'end') {
                        this.finishResponse();
                    } else if (message.type === 'error') {
                        this.showError(message.error);
                    } else if (message.type === 'timing') {
                        this.showTiming(parseFloat(message.content));
                    } else if (message.type === 'response_time') {
                        this.responseTime = parseFloat(message.content);
                    }
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };
            
            this.websocket.onerror = (error) => {
                console.error('WebSocket Error:', error);
                this.updateStatus('disconnected', 'Connection error');
            };
            
            this.websocket.onclose = () => {
                this.updateStatus('disconnected', 'Disconnected');
            };
            
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.showError(`WebSocket connection failed: ${error.message}`);
            this.updateStatus('disconnected', 'Connection failed');
        }
    }

    disconnect() {
        if (this.sseEventSource) {
            this.sseEventSource.close();
            this.sseEventSource = null;
        }
        
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        
        this.updateStatus('disconnected', 'Disconnected');
    }

    addMessage(content, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.textContent = content;
        
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageDiv;
    }

    appendToResponse(text) {
        if (this.currentResponseElement) {
            // Remove the streaming indicator first
            const indicator = this.currentResponseElement.querySelector('#streaming-indicator');
            if (indicator) {
                indicator.remove();
            }
            
            // Add the text to the response
            this.currentResponseElement.textContent += text;
            this.scrollToBottom();
        }
    }

    finishResponse() {
        if (this.currentResponseElement) {
            this.currentResponseElement.classList.remove('typing');
            
            // Remove streaming indicator
            const indicator = this.currentResponseElement.querySelector('#streaming-indicator');
            if (indicator) {
                indicator.remove();
            }
            
            this.currentResponseElement = null;
        }
    }

    showError(message) {
        if (this.currentResponseElement) {
            this.currentResponseElement.classList.remove('typing');
            this.currentResponseElement.style.color = '#e53e3e';
            this.currentResponseElement.textContent = `Error: ${message}`;
            this.currentResponseElement = null;
        }
        
        this.updateStatus('disconnected', 'Connection error');
    }

    updateStatus(status, message) {
        this.statusElement.className = `status ${status}`;
        this.statusElement.textContent = message;
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    showTiming(timing) {
        if (this.currentResponseElement) {
            // Add timing information to the current response
            const timingDiv = document.createElement('div');
            timingDiv.style.cssText = `
                margin-top: 0.5rem;
                font-size: 0.875rem;
                color: #6b7280;
                font-style: italic;
                border-top: 1px solid #e5e7eb;
                padding-top: 0.5rem;
            `;
            
            let timingText = '';
            if (this.currentProtocol === 'nostream') {
                timingText = `⏱️ Complete response generated in ${timing.toFixed(2)} seconds (No-Stream mode)`;
            } else {
                timingText = `⏱️ Response completed in ${timing.toFixed(2)} seconds`;
            }
            
            // Add response time if available
            if (this.responseTime) {
                timingText += `<br>⚡ First letter appeared in ${this.responseTime.toFixed(2)} seconds`;
            }
            
            timingDiv.innerHTML = timingText;
            this.currentResponseElement.appendChild(timingDiv);
            this.scrollToBottom();
        }
    }

    addStreamingIndicator() {
        if (this.currentResponseElement) {
            const indicator = document.createElement('div');
            indicator.id = 'streaming-indicator';
            indicator.textContent = '🤖 AI is thinking...';
            indicator.style.cssText = `
                color: #6b7280;
                font-style: italic;
                animation: pulse 1.5s infinite;
                margin-bottom: 0.5rem;
            `;
            this.currentResponseElement.appendChild(indicator);
        }
    }

    showDetailedTiming(backendTiming, displayTiming) {
        if (this.currentResponseElement) {
            // Add detailed timing information to the current response
            const timingDiv = document.createElement('div');
            timingDiv.style.cssText = `
                margin-top: 0.5rem;
                font-size: 0.875rem;
                color: #6b7280;
                font-style: italic;
                border-top: 1px solid #e5e7eb;
                padding-top: 0.5rem;
            `;
            
            const totalTime = backendTiming + displayTiming;
            timingDiv.innerHTML = `
                ⏱️ <strong>Timing Breakdown:</strong><br>
                • Backend processing: ${backendTiming.toFixed(2)}s<br>
                • Visual display effect: ${displayTiming.toFixed(2)}s<br>
                • <strong>Total time: ${totalTime.toFixed(2)}s</strong>
            `;
            
            this.currentResponseElement.appendChild(timingDiv);
            this.scrollToBottom();
        }
    }
}

// Global functions for HTML onclick handlers
let aiDemo;

document.addEventListener('DOMContentLoaded', () => {
    aiDemo = new AIAgentDemo();
    
    // Test connection immediately on page load
    setTimeout(() => {
        aiDemo.testConnection();
    }, 500); // Small delay to ensure everything is initialized
});

function switchProtocol(protocol) {
    if (aiDemo) {
        aiDemo.switchProtocol(protocol);
    }
}

function sendQuestion() {
    if (aiDemo) {
        aiDemo.sendQuestion();
    }
}

function handleKeyPress(event) {
    if (aiDemo) {
        aiDemo.handleKeyPress(event);
    }
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (aiDemo) {
        aiDemo.disconnect();
    }
}); 