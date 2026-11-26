const statusQuery='query globalData { userStatus { isSignedIn username isPremium } }';
const listQuery=`query problemsetQuestionList($categorySlug:String,$limit:Int,$skip:Int,$filters:QuestionListFilterInput){
  problemsetQuestionList:questionList(categorySlug:$categorySlug,limit:$limit,skip:$skip,filters:$filters){
    totalNum questions:data{questionFrontendId title titleSlug difficulty acRate isPaidOnly status topicTags{name slug}}
  }
}`;
const detailQuery=`query questionData($titleSlug:String!){question(titleSlug:$titleSlug){
  questionId questionFrontendId title titleSlug difficulty isPaidOnly content sampleTestCase exampleTestcases
  codeSnippets{lang langSlug code} metaData topicTags{name slug}
}}`;

// Run IDs contain a fractional timestamp (runcode_1627219627.5662382_...).
// Accept those as one bounded URL segment, while excluding traversal and delimiters.
export function isRemoteJudgeId(value){
  if(typeof value!=='string'&&!(Number.isSafeInteger(value)&&value>0))return false;
  const id=String(value);
  return id.length<=200&&/^[\w-]+(?:\.[\w-]+)*$/.test(id);
}

export class LeetCodeClient {
  constructor(session){this.session=session;}
  async graphql(operationName,query,variables={}){
    const response=await this.session.request('/graphql/',{method:'POST',body:{operationName,query,variables}});
    if(response.errors?.length)throw Object.assign(new Error(response.errors.map(e=>e.message).join('; ')),{status:502});
    return response.data;
  }
  async status(){const data=await this.graphql('globalData',statusQuery);return data.userStatus;}
  async list({skip=0,limit=20,search='',difficulty='',tag='',orderBy=''}={}){
    const filters={};if(search)filters.searchKeywords=search;if(difficulty)filters.difficulty=difficulty;if(tag)filters.tags=[tag];
    if(orderBy==='AC_RATE_DESC'){filters.orderBy='AC_RATE';filters.sortOrder='DESCENDING';}
    else if(orderBy==='AC_RATE_ASC'){filters.orderBy='AC_RATE';filters.sortOrder='ASCENDING';}
    const data=await this.graphql('problemsetQuestionList',listQuery,{categorySlug:'algorithms',limit,skip,filters});
    return data.problemsetQuestionList;
  }
  async problem(slug){
    if(!/^[a-z0-9-]+$/.test(slug))throw Object.assign(new Error('Invalid problem slug'),{status:400});
    const data=await this.graphql('questionData',detailQuery,{titleSlug:slug});
    if(!data.question)throw Object.assign(new Error('Problem not found'),{status:404});
    const q=data.question;
    let metadata=null;try{metadata=JSON.parse(q.metaData);}catch{}
    const raw=q.exampleTestcases||q.sampleTestCase||'';
    const args=metadata?.params||[];
    const lines=raw.trim()?raw.trim().split(/\r?\n/):[];
    const cases=[];
    if(!metadata?.systemdesign && args.length && lines.length%args.length===0){
      for(let i=0;i<lines.length;i+=args.length)cases.push({inputs:args.map((a,index)=>({name:a.name,type:a.type,raw:lines[i+index]}))});
    }
    return {...q,metadata,javaStarter:q.codeSnippets?.find(s=>s.langSlug==='java')?.code||null,cppStarter:q.codeSnippets?.find(s=>s.langSlug==='cpp')?.code||null,exampleInputs:{raw,cases,format:'leetcode-raw'},locked:!q.content};
  }
  async execute(kind,problem,code,input,lang='java'){
    if(!['java','cpp'].includes(lang))throw new Error('Unsupported language');
    const body={lang,question_id:problem.questionId,typed_code:code,test_mode:false};
    if(kind==='run')body.data_input=input;
    else body.judge_type='large';
    return this.session.request(`/problems/${problem.titleSlug}/${kind==='run'?'interpret_solution':'submit'}/`,{method:'POST',body,authenticated:true,referer:`https://leetcode.com/problems/${problem.titleSlug}/`});
  }
  async result(id){if(!isRemoteJudgeId(id))throw new Error('Invalid remote job id');return this.session.request(`/submissions/detail/${id}/check/`,{authenticated:true});}
  async submission(id){
    const submissionId=Number(id);if(!Number.isSafeInteger(submissionId)||submissionId<1)throw new Error('Invalid submission id');
    const data=await this.graphql('submissionDetails',`query submissionDetails($submissionId:Int!){submissionDetails(submissionId:$submissionId){code statusCode lang{name} question{questionId titleSlug} totalCorrect totalTestcases}}`,{submissionId});
    if(!data.submissionDetails)throw new Error('Submission details are not available to this session');
    return data.submissionDetails;
  }
}
