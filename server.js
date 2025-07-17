const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'your_openai_api_key_here'
});

// Generate unique conversation ID
function generateConversationId() {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Use existing or new conversation ID
    let currentConversationId = conversationId;
    let conversation = [];

    if (currentConversationId) {
      // Try to fetch existing conversation from Supabase
      const { data, error } = await supabase
        .from('conversations')
        .select('messages')
        .eq('conversation_id', currentConversationId)
        .single();
      if (data && data.messages) {
        conversation = data.messages;
      } else {
        // If not found, start a new conversation
        currentConversationId = generateConversationId();
      }
    } else {
      // No conversationId provided, start a new conversation
      currentConversationId = generateConversationId();
    }

    // Add user message
    conversation.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    });

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: "system",
          content: "You are a helpful and friendly chatbot assistant. Keep responses concise and engaging."
        },
        ...conversation.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ],
      max_tokens: 150,
      temperature: 0.7
    });

    const botResponse = completion.choices[0].message.content;

    // Add bot response
    conversation.push({
      role: 'assistant',
      content: botResponse,
      timestamp: new Date().toISOString()
    });

    // Upsert conversation in Supabase
    const { error: upsertError } = await supabase
      .from('conversations')
      .upsert([
        {
          conversation_id: currentConversationId,
          messages: conversation
        }
      ], { onConflict: ['conversation_id'] });
    if (upsertError) {
      console.error('Supabase upsert error:', upsertError);
    }

    res.json({
      response: botResponse,
      conversationId: currentConversationId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error calling OpenAI API or Supabase:', error);
    res.status(500).json({
      error: 'Failed to get response from AI',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Make sure to set your OPENAI_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY in the .env file');
}); 