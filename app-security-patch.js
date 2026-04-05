// Patched version of app.js

// Function to sanitize input and prevent XSS
function sanitizeInput(input) {
    return input.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Example usage of sanitized input
app.post('/submit', (req, res) => {
    const userInput = sanitizeInput(req.body.input);
    // Process the sanitized input
});

// Function to safely parse JSON
function safeJsonParse(input) {
    try {
        return JSON.parse(input);
    } catch (e) {
        throw new Error('Invalid JSON');
    }
}

// Example usage of safe JSON parsing
app.post('/data', (req, res) => {
    const jsonData = safeJsonParse(req.body.data);
    // Process the valid JSON data
});