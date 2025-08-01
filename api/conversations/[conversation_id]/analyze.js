import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  const { conversation_id } = req.query;
  if (req.method !== 'POST') return res.status(405).end();

  try {
    console.log('Analyzing conversation:', conversation_id);

    // Fetch the conversation
    const { data, error } = await supabase
      .from('conversations')
      .select('messages')
      .eq('conversation_id', conversation_id)
      .single();
    
    if (error || !data) {
      console.error('Conversation not found:', conversation_id);
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Prepare data for Make.com webhook
    const webhookData = {
      conversationId: conversation_id,
      messages: data.messages,
      timestamp: new Date().toISOString()
    };

    console.log('Sending data to Make.com webhook:', webhookData);

    // Send to Make.com webhook
    const makeResponse = await fetch(process.env.MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookData)
    });

    if (!makeResponse.ok) {
      throw new Error(`Make.com webhook failed: ${makeResponse.status} ${makeResponse.statusText}`);
    }

    // Get the response from Make.com (extracted info)
    const extractedInfo = await makeResponse.json();
    console.log('Received extracted info from Make.com:', extractedInfo);

    // Update Supabase with extracted information (only columns that exist)
    const updateData = {
      customerName: extractedInfo.customerName || null,
      customerEmail: extractedInfo.customerEmail || null,
      customerPhone: extractedInfo.customerPhone || null,
      customerIndustry: extractedInfo.customerIndustry || null,
      customerProblem: extractedInfo.customerProblem || null,
      customerAvailability: extractedInfo.customerAvailability || null,
      customerConsultation: extractedInfo.customerConsultation || false,
      specialNotes: extractedInfo.specialNotes || null,
      leadQuality: extractedInfo.leadQuality || null
    };

    const { error: updateError } = await supabase
      .from('conversations')
      .update(updateData)
      .eq('conversation_id', conversation_id);

    if (updateError) {
      console.error('Error updating Supabase:', updateError);
      throw new Error(`Failed to update database: ${updateError.message}`);
    }

    console.log('Analysis completed successfully for conversation:', conversation_id);

    res.json({ 
      success: true, 
      info: extractedInfo,
      message: 'Analysis completed successfully'
    });

  } catch (error) {
    console.error('Error in analysis:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
} 