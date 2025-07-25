import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  const { conversation_id } = req.query;

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('conversation_id', conversation_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } else {
    res.status(405).end();
  }
} 