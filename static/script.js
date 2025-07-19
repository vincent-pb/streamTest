class StreamingDemo {
    constructor() {
        this.sseEventSource = null;
        this.websocket = null;
        this.isSSEStreaming = false;
        this.isWSStreaming = false;
        
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        // SSE elements
        this.startSSEBtn = document.getElementById('startSSE');
        this.stopSSEBtn = document.getElementById('stopSSE');
        this.sseOutput = document.getElementById('sseOutput');

        // WebSocket elements
        this.startWSBtn = document.getElementById('startWS');
        this.stopWSBtn = document.getElementById('stopWS');
        this.wsOutput = document.getElementById('wsOutput');
    }

    bindEvents() {
        // SSE events
        this.startSSEBtn.addEventListener('click', () => this.startSSE());
        this.stopSSEBtn.addEventListener('click', () => this.stopSSE());

        // WebSocket events
        this.startWSBtn.addEventListener('click', () => this.startWebSocket());
        this.stopWSBtn.addEventListener('click', () => this.stopWebSocket());
    }

    // Server-Sent Events (SSE) Implementation
    startSSE() {
        if (this.isSSEStreaming) return;

        console.log('Starting SSE stream...');
        this.isSSEStreaming = true;
        this.updateSSEButtons(true);
        this.sseOutput.textContent = '';
        this.sseOutput.classList.add('typing');

        try {
            this.sseEventSource = new EventSource('/stream');
            console.log('EventSource created successfully');
            
            this.sseEventSource.onopen = (event) => {
                console.log('SSE connection opened');
            };
            
            this.sseEventSource.onmessage = (event) => {
                console.log('SSE received:', event.data);
                if (event.data === '[END]') {
                    console.log('SSE stream ended');
                    this.stopSSE();
                    return;
                }
                
                this.sseOutput.textContent += event.data;
                this.scrollToBottom(this.sseOutput);
            };

            this.sseEventSource.onerror = (error) => {
                console.error('SSE Error:', error);
                this.sseOutput.textContent += '\n[Connection Error]';
                this.stopSSE();
            };

        } catch (error) {
            console.error('Failed to create SSE connection:', error);
            this.sseOutput.textContent = 'Failed to connect to SSE stream';
            this.stopSSE();
        }
    }

    stopSSE() {
        this.isSSEStreaming = false;
        this.updateSSEButtons(false);
        this.sseOutput.classList.remove('typing');
        
        if (this.sseEventSource) {
            this.sseEventSource.close();
            this.sseEventSource = null;
        }
    }

    // WebSocket Implementation
    startWebSocket() {
        if (this.isWSStreaming) return;

        this.isWSStreaming = true;
        this.updateWSButtons(true);
        this.wsOutput.textContent = '';
        this.wsOutput.classList.add('typing');

        try {
            // Determine WebSocket URL based on current location
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            
            this.websocket = new WebSocket(wsUrl);

            this.websocket.onopen = (event) => {
                console.log('WebSocket connection established');
            };

            this.websocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    
                    if (message.type === 'end') {
                        this.stopWebSocket();
                        return;
                    }
                    
                    if (message.type === 'word') {
                        this.wsOutput.textContent += message.content;
                        this.scrollToBottom(this.wsOutput);
                    }
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };

            this.websocket.onerror = (error) => {
                console.error('WebSocket Error:', error);
                this.wsOutput.textContent += '\n[Connection Error]';
                this.stopWebSocket();
            };

            this.websocket.onclose = (event) => {
                console.log('WebSocket connection closed:', event.code, event.reason);
                if (this.isWSStreaming) {
                    this.stopWebSocket();
                }
            };

        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.wsOutput.textContent = 'Failed to connect to WebSocket stream';
            this.stopWebSocket();
        }
    }

    stopWebSocket() {
        this.isWSStreaming = false;
        this.updateWSButtons(false);
        this.wsOutput.classList.remove('typing');
        
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
    }

    // Utility methods
    updateSSEButtons(isStreaming) {
        this.startSSEBtn.disabled = isStreaming;
        this.stopSSEBtn.disabled = !isStreaming;
    }

    updateWSButtons(isStreaming) {
        this.startWSBtn.disabled = isStreaming;
        this.stopWSBtn.disabled = !isStreaming;
    }

    scrollToBottom(element) {
        element.scrollTop = element.scrollHeight;
    }
}

// Initialize the demo when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new StreamingDemo();
});

// Clean up connections when the page is unloaded
window.addEventListener('beforeunload', () => {
    // The browser will automatically close SSE and WebSocket connections
    // but we can add any additional cleanup here if needed
}); 