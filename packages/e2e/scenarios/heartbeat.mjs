const question='The synthetic task has two available slots: Tuesday or Thursday. Which should I use?';
const respond=(outcome,notify,summary,notificationText)=>({toolCalls:[{name:'heartbeat_respond',args:{outcome,notify,summary,...(notificationText?{notificationText}:{})}}]});
export default {
 id:'heartbeat-native-main-reply',
 heartbeat:true,
 adapters:{fixture_read:{kind:'read',operations:['list'],responses:{list:[{title:'Synthetic due task'}]}},fixture_write:{kind:'write',operations:['checkpoint']}},
 steps:[
  {incoming:[{text:'Remember MAIN_HISTORY_SENTINEL for later.'}],responses:[{text:'Remembered.'}],expect:{sends:['Remembered.']}},
  {wake:'QUIET_POLL_SENTINEL Check the synthetic due task and finish quietly.',responses:[{toolCalls:[{name:'fixture_read',args:{operation:'list'}}]},respond('no_change',false,'No change.'),{text:''}],expect:{sends:[],quietMs:3500,promptExcludes:['MAIN_HISTORY_SENTINEL']}},
  {wake:'QUESTION_POLL_SENTINEL Save a synthetic checkpoint and ask which slot to use.',responses:[{toolCalls:[{name:'fixture_write',args:{operation:'checkpoint',value:'Awaiting slot preference.'}}]},respond('needs_attention',true,'Need the user to choose a slot.',question),{text:''}],expect:{sends:[question],quietMs:3500,promptExcludes:['MAIN_HISTORY_SENTINEL','QUIET_POLL_SENTINEL']}},
  {wake:'INTERVENING_POLL_SENTINEL Nothing changed. Finish quietly.',responses:[respond('no_change',false,'Still waiting.'),{text:''}],expect:{sends:[],quietMs:3500,promptExcludes:['MAIN_HISTORY_SENTINEL','QUESTION_POLL_SENTINEL',question]}},
  {incoming:[{text:'Thursday, please.'}],responses:[{text:'I will use Thursday for the synthetic task.'}],expect:{sends:['I will use Thursday'],promptIncludes:[question,'Thursday, please.','MAIN_HISTORY_SENTINEL'],promptExcludes:['QUIET_POLL_SENTINEL','QUESTION_POLL_SENTINEL','INTERVENING_POLL_SENTINEL']}}
 ]
};
