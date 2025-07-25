import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message, conversationId } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  let currentConversationId = conversationId;
  let conversation = [];

  if (currentConversationId) {
    const { data } = await supabase
      .from('conversations')
      .select('messages')
      .eq('conversation_id', currentConversationId)
      .single();
    if (data && data.messages) {
      conversation = data.messages;
    } else {
      currentConversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
  } else {
    currentConversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  conversation.push({
    role: 'user',
    content: message,
    timestamp: new Date().toISOString()
  });

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

  conversation.push({
    role: 'assistant',
    content: botResponse,
    timestamp: new Date().toISOString()
  });

  await supabase
    .from('conversations')
    .upsert([
      {
        conversation_id: currentConversationId,
        messages: conversation
      }
    ], { onConflict: ['conversation_id'] });

  res.json({
    response: botResponse,
    conversationId: currentConversationId,
    timestamp: new Date().toISOString()
  });
} 