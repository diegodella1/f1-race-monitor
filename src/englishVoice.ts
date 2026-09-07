type Voice={lang:string;voiceURI:string;localService?:boolean};
export function selectEnglishVoice<T extends Voice>(voices:T[],preferredURI:string):T|null{
  const english=voices.filter(voice=>voice.lang.toLowerCase().startsWith('en'));
  return english.find(voice=>voice.voiceURI===preferredURI)
    ??english.find(voice=>voice.localService&&voice.lang.toLowerCase()==='en-us')
    ??english.find(voice=>voice.localService)
    ??english.find(voice=>voice.lang.toLowerCase()==='en-us')
    ??english[0]??null;
}
