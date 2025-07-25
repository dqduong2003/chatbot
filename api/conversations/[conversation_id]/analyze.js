import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  const { conversation_id } = req.query;
  if (req.method !== 'POST') return res.status(405).end();

  // Fetch the conversation
  const { data, error } = await supabase
    .from('conversations')
    .select('messages')
    .eq('conversation_id', conversation_id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Conversation not found' });

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

  // Update the conversation row with extracted info
  const { error: updateError } = await supabase
    .from('conversations')
    .update(info)
    .eq('conversation_id', conversation_id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  res.json({ success: true, info });
} 