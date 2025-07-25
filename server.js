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
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: "system",
          content: `You are the MindTek AI Assistant — a friendly and helpful virtual assistant representing MindTek AI, a company that offers AI consulting and implementation services.
            Your goal is to guide users through a structured discovery conversation to understand their industry, challenges, and contact details, and recommend appropriate services.
            💬 Always keep responses short, helpful, and polite.
            💬 Always reply in the same language the user speaks.
            💬 Ask only one question at a time.
            🔍 RECOMMENDED SERVICES:
            - For real estate: Mention customer data extraction from documents, integration with CRM, and lead generation via 24/7 chatbots.
            - For education: Mention email automation and AI training.
            - For retail/customer service: Mention voice-based customer service chatbots, digital marketing, and AI training.
            - For other industries: Mention chatbots, process automation, and digital marketing.
            ✅ BENEFITS: Emphasize saving time, reducing costs, and improving customer satisfaction.
            💰 PRICING: Only mention 'starting from $1000 USD' if the user explicitly asks about pricing.
            🧠 CONVERSATION FLOW:
            1. Ask what industry the user works in.
            2. Then ask what specific challenges or goals they have.
            3. Based on that, recommend relevant MindTek AI services.
            4. Ask if they'd like to learn more about the solutions.
            5. If yes, collect their name → email → phone number (one at a time).
            6. Provide a more technical description of the solution and invite them to book a free consultation.
            7. Finally, ask if they have any notes or questions before ending the chat.
            ⚠️ OTHER RULES:
            - Be friendly but concise.
            - Do not ask multiple questions at once.
            - Do not mention pricing unless asked.
            - Stay on-topic and professional throughout the conversation.`
        },
        ...conversation.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ],
      max_tokens: 200,
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

// Add this before the catch-all route
app.get('/api/conversations', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('conversation_id, messages, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/conversations/:conversation_id', async (req, res) => {
  const { conversation_id } = req.params;
  try {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('conversation_id', conversation_id);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversations/:conversation_id/analyze', async (req, res) => {
  console.log('Analyze endpoint called')
  const { conversation_id } = req.params;
  try {
    // Fetch the conversation
    const { data, error } = await supabase
      .from('conversations')
      .select('messages')
      .eq('conversation_id', conversation_id)
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Prepare transcript
    const transcript = data.messages.map(m => `${m.role}: ${m.content}`).join('\n');

    // System prompt
    const system_prompt = `Extract the following customer details from the transcript:
- Name
- Email address
- Phone number
- Industry
- Problems, needs, and goals summary
- Availability
- Whether they have booked a consultation (true/false)
- Any special notes
- Lead quality (categorize as 'good', 'ok', or 'spam')

Format the response according to this JSON schema:
{
  "type": "object",
  "properties": {
    "customerName": { "type": "string" },
    "customerEmail": { "type": "string" },
    "customerPhone": { "type": "string" },
    "customerIndustry": { "type": "string" },
    "customerProblem": { "type": "string" },
    "customerAvailability": { "type": "string" },
    "customerConsultation": { "type": "boolean" },
    "specialNotes": { "type": "string" },
    "leadQuality": { "type": "string", "enum": ["good", "ok", "spam"] }
  },
  "required": ["customerName", "customerEmail", "customerProblem", "leadQuality"]
}
good if user left contact detail and no if not.`;

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: system_prompt },
        { role: 'user', content: transcript }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 512,
      temperature: 0
    });

    const info = JSON.parse(completion.choices[0].message.content);
    console.log('Extracted info from OpenAI:', info);

    // Update the conversation row with extracted info
    const { error: updateError } = await supabase
      .from('conversations')
      .update(info)
      .eq('conversation_id', conversation_id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true, info });
  } catch (err) {
    res.status(500).json({ error: err.message });
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