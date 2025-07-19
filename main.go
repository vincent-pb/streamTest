package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	openai "github.com/sashabaranov/go-openai"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for demo
	},
}

type Message struct {
	Type    string `json:"type"`
	Content string `json:"content"`
}

type UserQuestion struct {
	Question string `json:"question"`
}

type AIResponse struct {
	Type    string `json:"type"`
	Content string `json:"content"`
	Error   string `json:"error,omitempty"`
}

var openaiClient *openai.Client

func main() {
	// Initialize OpenAI client
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		log.Println("Warning: OPENAI_API_KEY not set. AI agent features will be disabled.")
		log.Println("To enable AI features, set your OpenAI API key:")
		log.Println("export OPENAI_API_KEY=your_api_key_here")
	} else {
		openaiClient = openai.NewClient(apiKey)
		log.Println("OpenAI client initialized successfully")
	}

	r := mux.NewRouter()

	// Serve static files
	r.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	r.HandleFunc("/", serveIndex)
	r.HandleFunc("/ai", serveAI)

	// Demo endpoints for streaming
	r.HandleFunc("/stream", handleSSE)
	r.HandleFunc("/ws", handleWebSocket)

	// AI agent endpoints
	r.HandleFunc("/ai/stream", handleAISSE).Methods("POST")
	r.HandleFunc("/ai/ws", handleAIWebSocket)
	r.HandleFunc("/ai/nostream", handleAINoStream).Methods("POST")
	r.HandleFunc("/ai/test", handleAITest)

	fmt.Println("Server starting on http://localhost:8080")
	fmt.Println("AI Agent Demo: Available at http://localhost:8080/ai")
	fmt.Println("AI Test Endpoint: Available at http://localhost:8080/ai/test")
	log.Fatal(http.ListenAndServe(":8080", r))
}

func serveIndex(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "static/index.html")
}

func serveAI(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "static/ai.html")
}

// Demo SSE handler (original functionality)
func handleSSE(w http.ResponseWriter, r *http.Request) {
	// Set headers for SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Get context from request
	ctx := r.Context()

	// Simulate streaming text generation
	text := "Hello! This is a demonstration of real-time text streaming from Go backend to JavaScript frontend. The text is being generated word by word and sent to the frontend as it becomes available. This creates a much better user experience compared to waiting for the entire response to be generated before displaying anything."
	words := splitIntoWords(text)

	for _, word := range words {
		select {
		case <-ctx.Done():
			// Client disconnected
			return
		default:
			// Send the word as an SSE event
			fmt.Fprintf(w, "data: %s\n\n", word)
			w.(http.Flusher).Flush()

			// Simulate processing time
			time.Sleep(200 * time.Millisecond)
		}
	}

	// Send end signal
	fmt.Fprintf(w, "data: [END]\n\n")
	w.(http.Flusher).Flush()
}

// Demo WebSocket handler (original functionality)
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// Simulate streaming text generation
	text := "Hello! This is a WebSocket demonstration of real-time text streaming from Go backend to JavaScript frontend. The text is being generated word by word and sent to the frontend as it becomes available. This creates a much better user experience compared to waiting for the entire response to be generated before displaying anything."
	words := splitIntoWords(text)

	for _, word := range words {
		message := Message{
			Type:    "word",
			Content: word,
		}

		err := conn.WriteJSON(message)
		if err != nil {
			log.Printf("WebSocket write failed: %v", err)
			return
		}

		// Simulate processing time
		time.Sleep(200 * time.Millisecond)
	}

	// Send end signal
	endMessage := Message{
		Type:    "end",
		Content: "",
	}
	conn.WriteJSON(endMessage)
}

// AI Agent SSE handler
func handleAISSE(w http.ResponseWriter, r *http.Request) {
	if openaiClient == nil {
		http.Error(w, "OpenAI client not initialized", http.StatusServiceUnavailable)
		return
	}

	// Parse user question
	var userQuestion UserQuestion
	if err := json.NewDecoder(r.Body).Decode(&userQuestion); err != nil {
		log.Printf("Failed to decode request body: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(userQuestion.Question) == "" {
		http.Error(w, "Question cannot be empty", http.StatusBadRequest)
		return
	}

	log.Printf("Received question via SSE: %s", userQuestion.Question)

	// Start timing
	startTime := time.Now()

	// Set headers for SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ctx := r.Context()

	// Create OpenAI request
	req := openai.ChatCompletionRequest{
		Model: openai.GPT3Dot5Turbo,
		Messages: []openai.ChatCompletionMessage{
			{
				Role:    openai.ChatMessageRoleUser,
				Content: userQuestion.Question,
			},
		},
		Stream: true,
	}

	log.Printf("Creating OpenAI stream request...")

	// Create streaming response
	stream, err := openaiClient.CreateChatCompletionStream(ctx, req)
	if err != nil {
		log.Printf("OpenAI stream creation failed: %v", err)
		fmt.Fprintf(w, "data: [ERROR] Failed to connect to OpenAI: %s\n\n", err.Error())
		w.(http.Flusher).Flush()
		return
	}
	defer stream.Close()

	log.Printf("OpenAI stream created successfully, starting to receive data...")

	// Stream the response
	hasReceivedContent := false
	firstContentTime := time.Time{}
	for {
		response, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				log.Printf("OpenAI stream ended normally (EOF)")
				break
			}
			if err.Error() == "stream finished" {
				log.Printf("OpenAI stream finished normally")
				break
			}
			log.Printf("Stream receive error: %v (type: %T)", err, err)
			if !hasReceivedContent {
				fmt.Fprintf(w, "data: [ERROR] OpenAI API error: %s\n\n", err.Error())
				w.(http.Flusher).Flush()
			}
			return
		}

		if len(response.Choices) > 0 {
			content := response.Choices[0].Delta.Content
			if content != "" {
				hasReceivedContent = true

				// Track first content received
				if firstContentTime.IsZero() {
					firstContentTime = time.Now()
					responseTime := firstContentTime.Sub(startTime).Seconds()
					log.Printf("First content received in %.2f seconds", responseTime)
					fmt.Fprintf(w, "data: [RESPONSE_TIME] %.2f\n\n", responseTime)
					w.(http.Flusher).Flush()
				}

				// Send each word as it comes
				words := splitIntoWords(content)
				for _, word := range words {
					select {
					case <-ctx.Done():
						log.Printf("Client disconnected, stopping stream")
						return
					default:
						fmt.Fprintf(w, "data: %s\n\n", word)
						w.(http.Flusher).Flush()
					}
				}
			}
		}
	}

	// Calculate duration
	duration := time.Since(startTime)
	durationSeconds := duration.Seconds()

	if !hasReceivedContent {
		log.Printf("No content received from OpenAI, sending error message")
		fmt.Fprintf(w, "data: [ERROR] No response received from OpenAI. Please check your API key and account status.\n\n")
		w.(http.Flusher).Flush()
	} else {
		log.Printf("Stream completed successfully in %.2f seconds", durationSeconds)
	}

	// Send timing information
	fmt.Fprintf(w, "data: [TIMING] %.2f\n\n", durationSeconds)
	w.(http.Flusher).Flush()

	// Send end signal
	fmt.Fprintf(w, "data: [END]\n\n")
	w.(http.Flusher).Flush()
}

// AI Agent WebSocket handler
func handleAIWebSocket(w http.ResponseWriter, r *http.Request) {
	if openaiClient == nil {
		http.Error(w, "OpenAI client not initialized", http.StatusServiceUnavailable)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	log.Printf("WebSocket connection established for AI agent")

	// Listen for user questions
	for {
		var message Message
		err := conn.ReadJSON(&message)
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}

		if message.Type == "question" {
			question := message.Content
			if strings.TrimSpace(question) == "" {
				conn.WriteJSON(AIResponse{Type: "error", Error: "Question cannot be empty"})
				continue
			}

			log.Printf("Received question via WebSocket: %s", question)

			// Start timing
			startTime := time.Now()

			// Create OpenAI request
			req := openai.ChatCompletionRequest{
				Model: openai.GPT3Dot5Turbo,
				Messages: []openai.ChatCompletionMessage{
					{
						Role:    openai.ChatMessageRoleUser,
						Content: question,
					},
				},
				Stream: true,
			}

			log.Printf("Creating OpenAI stream request for WebSocket...")

			// Create streaming response
			stream, err := openaiClient.CreateChatCompletionStream(context.Background(), req)
			if err != nil {
				log.Printf("OpenAI stream creation failed for WebSocket: %v", err)
				conn.WriteJSON(AIResponse{Type: "error", Error: fmt.Sprintf("Failed to connect to OpenAI: %s", err.Error())})
				continue
			}

			log.Printf("OpenAI stream created successfully for WebSocket, starting to receive data...")

			// Stream the response
			hasReceivedContent := false
			firstContentTime := time.Time{}
			for {
				response, err := stream.Recv()
				if err != nil {
					if err == io.EOF {
						log.Printf("OpenAI stream ended normally (EOF) for WebSocket")
						break
					}
					if err.Error() == "stream finished" {
						log.Printf("OpenAI stream finished normally for WebSocket")
						break
					}
					log.Printf("Stream receive error for WebSocket: %v (type: %T)", err, err)
					if !hasReceivedContent {
						conn.WriteJSON(AIResponse{Type: "error", Error: fmt.Sprintf("OpenAI API error: %s", err.Error())})
					}
					break
				}

				if len(response.Choices) > 0 {
					content := response.Choices[0].Delta.Content
					if content != "" {
						hasReceivedContent = true

						// Track first content received
						if firstContentTime.IsZero() {
							firstContentTime = time.Now()
							responseTime := firstContentTime.Sub(startTime).Seconds()
							log.Printf("First content received via WebSocket in %.2f seconds", responseTime)
							conn.WriteJSON(AIResponse{Type: "response_time", Content: fmt.Sprintf("%.2f", responseTime)})
						}

						// Send each word as it comes
						words := splitIntoWords(content)
						for _, word := range words {
							err := conn.WriteJSON(AIResponse{Type: "word", Content: word})
							if err != nil {
								log.Printf("WebSocket write error: %v", err)
								return
							}
						}
					}
				}
			}

			stream.Close()

			// Calculate duration
			duration := time.Since(startTime)
			durationSeconds := duration.Seconds()

			if !hasReceivedContent {
				log.Printf("No content received from OpenAI for WebSocket, sending error message")
				conn.WriteJSON(AIResponse{Type: "error", Error: "No response received from OpenAI. Please check your API key and account status."})
			} else {
				log.Printf("WebSocket stream completed successfully in %.2f seconds", durationSeconds)
			}

			// Send timing information
			conn.WriteJSON(AIResponse{Type: "timing", Content: fmt.Sprintf("%.2f", durationSeconds)})

			// Send end signal
			conn.WriteJSON(AIResponse{Type: "end"})
		}
	}
}

func splitIntoWords(text string) []string {
	// Simple word splitting for demo
	var words []string
	var currentWord string

	for _, char := range text {
		if char == ' ' || char == '.' || char == ',' || char == '!' || char == '?' {
			if currentWord != "" {
				words = append(words, currentWord+string(char))
				currentWord = ""
			} else {
				words = append(words, string(char))
			}
		} else {
			currentWord += string(char)
		}
	}

	if currentWord != "" {
		words = append(words, currentWord)
	}

	return words
}

// AI Test handler to verify OpenAI API connectivity
func handleAITest(w http.ResponseWriter, r *http.Request) {
	if openaiClient == nil {
		http.Error(w, "OpenAI client not initialized", http.StatusServiceUnavailable)
		return
	}

	log.Printf("Testing OpenAI API connectivity...")

	// Test with a simple request
	req := openai.ChatCompletionRequest{
		Model: openai.GPT3Dot5Turbo,
		Messages: []openai.ChatCompletionMessage{
			{
				Role:    openai.ChatMessageRoleUser,
				Content: "Hello",
			},
		},
		MaxTokens: 10,
	}

	resp, err := openaiClient.CreateChatCompletion(context.Background(), req)
	if err != nil {
		log.Printf("OpenAI API test failed: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "error",
			"message": fmt.Sprintf("OpenAI API test failed: %v", err),
		})
		return
	}

	log.Printf("OpenAI API test successful")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "success",
		"message":  "OpenAI API is working correctly",
		"response": resp.Choices[0].Message.Content,
	})
}

// AI No-Stream handler for complete response at once
func handleAINoStream(w http.ResponseWriter, r *http.Request) {
	if openaiClient == nil {
		http.Error(w, "OpenAI client not initialized", http.StatusServiceUnavailable)
		return
	}

	// Parse user question
	var userQuestion UserQuestion
	if err := json.NewDecoder(r.Body).Decode(&userQuestion); err != nil {
		log.Printf("Failed to decode request body: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(userQuestion.Question) == "" {
		http.Error(w, "Question cannot be empty", http.StatusBadRequest)
		return
	}

	log.Printf("Received question via No-Stream: %s", userQuestion.Question)

	// Start timing - from question receipt to complete response
	startTime := time.Now()
	log.Printf("Starting No-Stream processing timer...")

	// Create OpenAI request (non-streaming)
	req := openai.ChatCompletionRequest{
		Model: openai.GPT3Dot5Turbo,
		Messages: []openai.ChatCompletionMessage{
			{
				Role:    openai.ChatMessageRoleUser,
				Content: userQuestion.Question,
			},
		},
		Stream: false, // Non-streaming request
	}

	log.Printf("Creating OpenAI non-streaming request...")

	// Get complete response
	resp, err := openaiClient.CreateChatCompletion(context.Background(), req)
	if err != nil {
		log.Printf("OpenAI non-streaming request failed: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("Failed to get response from OpenAI: %s", err.Error()),
		})
		return
	}

	// Calculate total duration (question receipt to complete response)
	duration := time.Since(startTime)
	durationSeconds := duration.Seconds()

	log.Printf("No-Stream processing completed:")
	log.Printf("  - Question received and processed")
	log.Printf("  - OpenAI API call completed")
	log.Printf("  - Complete response generated")
	log.Printf("  - Total time: %.2f seconds", durationSeconds)

	// Prepare response
	response := map[string]interface{}{
		"response":      resp.Choices[0].Message.Content,
		"timing":        durationSeconds,
		"response_time": durationSeconds, // For No-Stream, response time equals total processing time
		"status":        "success",
	}

	// Send response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
