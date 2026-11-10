// Research and sending are independent. Keep the discovery failure visible,
// but never let it prevent an attempt to process the saved prospect queue.
export async function runProspectingStages({outreach,collect}) {
  const failures=[];
  for(const stage of [outreach,collect]) {
    try{await stage();}catch(error){failures.push(error);}
  }
  if(failures.length)throw new AggregateError(failures,'Professional outreach or collection needs attention');
}
