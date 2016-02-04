var audio_context;
var isPlaying = false;      // Are we currently playing?
var startTime;              // The start time of the entire sequence.
var currentSubdivision;        // What note is currently last scheduled?
var tempo = 108.0;          // tempo (in beats per minute)
var lookahead = 25.0;       // How frequently to call scheduling function 
                            //(in milliseconds)
var scheduleAheadTime = 0.1;    // How far ahead to schedule audio (sec)
                            // This is calculated from lookahead, and overlaps 
                            // with next interval (in case the timer is late)
var nextNoteTime = 0.0;     // when the next note is due.
var noteLength = 0.05;      // length of "beep" (in seconds)
var canvas,                 // the canvas element
    canvasContext;          // canvasContext is the canvas' context 2D
var lastSubdivisionDrawn = -1; // the last "box" we drew on the screen
var notesInQueue = [];      // the notes that have been put into the web audio,
                            // and may or may not have played yet. {note, time}
var timerWorker = null;     // The Web Worker used to fire timer messages
var osc;
//PULSE Theme
/*
1. Ability to click in 2/4/, 3/4, 4/4, 5/4, 6/8 and 7/8
2. "Enter Tempo" field so you can manually type in the tempo you want.
2. "Silent" mode with light flash
*/
var contemporaryNames = false;
var tempos =    {
                'traditional' :
                    {
                    'largo': [40, 60, -3],
                    'adagio': [61, 76, -2],
                    'andante': [77, 108, -1],
                    'moderato': [109, 120, 0],
                    'allegro': [121, 168, 1],
                    'presto': [167, 208, 2],
                    'molto presto': [209, 1000, 3]
                    },
                'contemporary' :
                    {
                    'ballad': [40, 60, -3],
                    'laid back': [61, 76, -2],
                    'medium': [77, 108, -1],
                    'medium swing': [109, 120, 0],
                    'up-tempo': [121, 168, 1],
                    'fast': [167, 208, 2],
                    'very fast': [209, 100, 3]
                    }
                };
var inputted_meter = '2/4'; 
var meter = {
            '2/4':{'low': 4, 'mid': 2, 'isSimple': true},
            '3/4':{'low': 6, 'mid': 2, 'isSimple': true},
            '4/4':{'low': 8, 'mid': 4, 'isSimple': true},
            '5/4':{'low': 10, 'mid': 0, 'isSimple': true},
            '6/8':{'low': 12, 'mid': 6, 'isSimple': false},
            '7/8':{'low': 14,'mid': 0, 'isSimple': true},
            'getInput': function (){
                        return meter[inputted_meter];
                    }
            };

function scanTempoRanges(tempo){
    //tempoMode will be 'traditional' or 'contemporary'
    if (tempo > 208) {
        return contemporaryNames?"very fast":"molto presto";
    } else {
        var tempoMode = Object.keys(tempos)[contemporaryNames?1:0];
        for (t in tempos[tempoMode]){
            if (tempo <= tempos[tempoMode][t][1]){
                return t;
            }
        }
    }
}

function scaleRotation(tempo_name){
    //alert('scaleRotation('+tempo_name+')');
    tempo = document.getElementById('range').value;
    var tempo_mode = Object.keys(tempos)[contemporaryNames?1:0];
    var scaled;
    var current_range = tempos[tempo_mode][tempo_name];
    var tempo_index = current_range[2];
    //alert(tempo_index);
    var min_range = current_range[0];
    //alert(min_range);
    var max_range = current_range[1];
    //alert(max_range);
    var distance = max_range-min_range;
    //alert(distance);
    var percent = (tempo-min_range)/distance;
    //alert(percent);
    scaled = (45*tempo_index)+(45.*percent);
    //alert(scaled);
    return scaled;
}

function changeTempo(v){
    var rotation;
    if (v > 208){
        v = 208;
    }
    if (v < 40) {
        v = 40;
    }
    tempo = v;
    document.getElementById('tempo').value = tempo;
    document.getElementById('range').value = tempo;
    document.getElementById('showTempo').innerHTML=tempo;
    var tempo_name = scanTempoRanges(tempo);
    document.getElementById('tempoName').innerHTML=tempo_name.toUpperCase();
    var degrees = scaleRotation(tempo_name);
    document.getElementById('dial').style.transform = 'rotate('+degrees+'deg)';
    document.getElementById('dial').style.webkitTransform = 'rotate('+degrees+'deg)';
    //alert(document.getElementById('dial').style.transform);
}

// First, let's shim the requestAnimationFrame API, with a setTimeout fallback
window.requestAnimFrame = (function(){
    return  window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.oRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    function( callback ){
        window.setTimeout(callback, 1000 / 60);
    };
})();

function nextNote() {
    //alert('nextNote');
    // Advance current note and time by a 8th note...
    var secondsPerBeat = 60.0 / tempo;    // Notice this picks up the CURRENT 
                                          // tempo value to calculate beat length
    //alert(secondsPerBeat);
    nextNoteTime += 0.5 * secondsPerBeat;    // Add beat length to last beat time
    //alert(nextNoteTime)
    currentSubdivision++;    // Advance the beat number, wrap to zero
    if (currentSubdivision == meter.getInput().low) {
        currentSubdivision = 0;
    }
    //alert(currentSubdivision);
}

function scheduleNote( beatNumber, time ) {
    //alert('scheduleNote('+beatNumber+', '+time+' )');
    // push the note on the queue, even if we're not playing.
    notesInQueue.push( { note: beatNumber, time: time } );
    //console.log(beatNumber);
   //console.log(time);
    if ( (inputted_meter.slice(2,3)==4) && (beatNumber%2)){
        return; // we're not playing non-quarter 8th notes
    }
    if ( (inputted_meter.slice(2,3)==8) && (beatNumber%2) ){
        return; 
    }
    // create an oscillator
    osc = audio_context.createOscillator();
    osc.connect( audio_context.destination );
    var meter_data = meter.getInput();
    if (beatNumber % meter_data.low === 0)    // beat 0 == low pitch
        osc.frequency.value = 880.0;
    else if (beatNumber % meter_data.mid === 0 )    // quarter notes = medium pitch
        osc.frequency.value = 440.0;
    else                        // other 8th notes = high pitch
        osc.frequency.value = 220.0;

    osc.start( time );
    osc.stop( time + noteLength );
    //alert(osc);
}

function scheduler() {
    // while there are notes that will need to play before the next interval, 
    // schedule them and advance the pointer.
    while (nextNoteTime < audio_context.currentTime + scheduleAheadTime ) {
        //alert(nextNoteTime);
        //alert(audio_context.currentTime + scheduleAheadTime);
        scheduleNote( currentSubdivision, nextNoteTime );
        nextNote();
    }
    //alert('break while loop');
    //alert(nextNoteTime);
    //alert(audio_context.currentTime);
}

function play() {
    isPlaying = !isPlaying;

    if (isPlaying) { // start playing
        osc = audio_context.createOscillator();
        osc.frequency.value = 200;
        osc.connect(audio_context.destination);
        osc.start(0);
        currentSubdivision = 0;
        nextNoteTime = audio_context.currentTime;
        timerWorker.postMessage("start");
        osc.stop(0);
        return "stop";
    } else {
        timerWorker.postMessage("stop");
        return "play";
    }
}

function resetCanvas (e) {
    // resize the canvas - but remember - this clears the canvas too.
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    //make sure we scroll to the top left.
    window.scrollTo(0,0); 
}

function draw() {
    var currentNote = lastSubdivisionDrawn;
    var currentTime = audio_context.currentTime;

    
    //do we have more notes? is the note time less that the current time?
    while (notesInQueue.length && notesInQueue[0].time < currentTime) {
        currentNote = notesInQueue[0].note; //update currentNote
        notesInQueue.splice(0,1);   // remove note from queue
    }

    // We only need to draw if the note has moved.
    if (lastSubdivisionDrawn != currentNote) {
        //alert('currentNote');
        var current_meter = meter.getInput(); //get user inputted meter
        canvasContext.clearRect(0,0,canvas.width, canvas.height); //clear canvas
        if (currentNote%2===1) { //odd beat? 
            canvasContext.globalAlpha = 0.2; //transparent
        } else { //even beat?
            canvasContext.globalAlpha = 1.0; //opaque
        }
        canvasContext.fillStyle = ( currentNote == 0 ) ? 
            ((currentNote%2 === 0)?"#FFFFFF":"#adbb37") : "#0a82a7";
        canvasContext.fillRect( 0 , 0, canvas.width, canvas.height );
        lastSubdivisionDrawn = currentNote;
    }

    // set up to draw again
    requestAnimFrame(draw);

}

function init(){
    var container = document.createElement( 'div' );
    container.className = "container";
    //container.width: "100%";
    //container.textAlign: "center";
    canvas = document.createElement( 'canvas' );
    canvasContext = canvas.getContext( '2d' );
    canvas.width = 10; 
    canvas.height = 10;
    //canvas.setAttribute('display', "inline");
    document.body.appendChild( container );
    container.appendChild(canvas);    
    canvasContext.strokeStyle = "#ffffff";
    canvasContext.lineWidth = 2;

    // NOTE: THIS RELIES ON THE MONKEYPATCH LIBRARY BEING LOADED FROM
    // ./js/AudioContextMonkeyPatch.js
    // TO WORK ON CURRENT CHROME!!  But this means our code can be properly
    // spec-compliant, and work on Chrome, Safari and Firefox.
    //6-25-2015
    try {
        audio_context = new AudioContext();  
    }catch (e){
        alert('No web audio support in this browser');
    }
    try {
        osc = audio_context.createOscillator();
    } catch (e){
        alert('No web audio oscillator support in this browser');        
    }
    // if we wanted to load audio files, etc., this is where we should do it.    
    //if we want to resize with window...
    //window.onorientationchange = resetCanvas;
    //window.onresize = resetCanvas;

    requestAnimFrame(draw);    // start the drawing loop.
    timerWorker = new Worker("js/metronomeworker.js");
    //alert(timerWorker);
    timerWorker.onmessage = function(e) {
        if (e.data == "tick") {
            //alert("tick!");
            scheduler();
        }
        else
            console.log("message: " + e.data);
    };
    //alert(timerWorker.onmessage);
    timerWorker.postMessage({"interval":lookahead});
}

window.addEventListener("load", init );

