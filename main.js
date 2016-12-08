var dCanvas = document.getElementById('dataCanvas');
var dContext = dCanvas.getContext('2d');

var dataImage = new Image;
var backgroundImage = new Image;
var dataImageStale = true;

var cellWidth = 60, cellHeight = 10;
var nRows = 21, nCols = 11;
var data = new Array(nRows);
var headers = new Array(nCols);
var categorical = new Array(nCols-1); // whether each header is categorical or not (excludes the first 'row number' header)

var trainingSet = []; 	// each element is the row index of a training row
var guessedSet = []; 	// each element is the [row,col] array of a guessed cell
//'confidences', 2-D array mirroring the structure of the data, containing, confusingly, prediction 'distances'
// i.e. the inverse of confidence
var confidences = singleValueArray(-1,nRows,nCols); // -1 signifies that no confidence has been computed yet
var normalisedConfidences = singleValueArray(0,nRows,nCols); // self-explanatory
var meanPairwiseDistance; // single number containing mean pairwise distance between rows
var distanceHistory = []; // contains a data point for whenever the mean distance changes
var divergenceHistory = []; // contains a data point for whenever the training set divergence changes

var lastSheetSelectionBounds = [0,0,0,0];

var lens = document.getElementById('lens');
lens.height = Math.round(10*cellHeight);
lens.width = Math.round(cellWidth*nCols);

var networkContainer = document.getElementById('network');
var nodes = [], edges = [];

// prepare startup dataset
for (var i=0; i<nCols; i++) 
{
	headers[i] = String.fromCharCode("A".charCodeAt(0)+i-1);
	if(i>0) categorical[i-1]=false;
}
data[0] = headers;


for (var i=1;i<data.length;i++)
{
	data[i] = new Array(nCols);

	data[i][0] = i; // row number
	nodes[i-1] = {id: i, label: i.toString()};
	for (var j=1; j<data[i].length; j++)
	{
		//Math.random()*Math.abs(Math.sin(i/5)*Math.sin(j/5));
		data[i][j] = Math.round(Math.random()*10);
	}
}

// set size of canvas
dCanvas.height = Math.round(0.8*window.innerHeight);
dCanvas.width = Math.round(0.05*window.innerWidth);

drawData();
drawDistributions();
refreshMeanPairwiseDistance();

// SET UP NETWORK VISUALISATION --------------------------------------------------

var networkData= {nodes: nodes, edges: edges};

var options = {
	width: '100%', //setting a width to auto was fucking up the dragging of nodes
	height: '500px',
	smoothCurves: false, // smoothCurves is really expensive
	hideEdgesOnDrag: true, // wish I could do this all the time
	navigation: true,

	physics: {
	  	barnesHut: {
			enabled: true,
			gravitationalConstant: -2000,
			centralGravity: 0.1, // stops disconnected components from floating away
			springLength: 95,
			springConstant: 0.01, // default: 0.05, lowered to space things out
			damping: 0.1 // I thought higher damping, which leads to more stability, fucks up clicking on nodes
						 // but it's "width:auto" that was causing the fuckery
	  	}
	  	/*
	  	,
	  	repulsion: {
			centralGravity: 0.1,
			springLength: 50,
			springConstant: 0.05,
			nodeDistance: 100,
			damping: 0.09
	  	},
	  	hierarchicalRepulsion: {
			centralGravity: 0.5,
			springLength: 150,
			springConstant: 0.01,
			nodeDistance: 60,
			damping: 0.09
	  	}
	  	*/

	}

};
var network = new vis.Network(networkContainer, networkData, options);

drawNetwork();

// SET UP SPREADSHEET TABLE ------------------------------------------------------
var sheetContainer = document.getElementById('sheetContainer');
var sheetSettings = {data: data,
					 //rowHeaders: true,
					 //colHeaders: true,
					 // the next two settings let me simulate persistent headers from my own dataset
					 fixedRowsTop: 1,
					 fixedColumnsLeft: 1, 
					 stretchH:'all', // makes columns expand to full width, if few columns
					 cells: function (row, col, prop) {
					    var cellProperties = {};

					    if (row === 0 || this.instance.getData()[row][col] === 'readOnly') {
					      cellProperties.readOnly = true; // make cell read-only if it is first row or the text reads 'readOnly'
					      cellProperties.renderer = (function (instance, td, row, col, prop, value, cellProperties) {
							  Handsontable.renderers.TextRenderer.apply(this, arguments);
							  td.style.background=(getColourByRowCol(row,col));
							});
					    }
					    else if (col === 0) {
					    	cellProperties.readOnly = true; // make cell read-only if it is first column
					      	cellProperties.renderer = (function (instance, td, row, col, prop, value, cellProperties) {
							  Handsontable.renderers.TextRenderer.apply(this, arguments);
							  td.style.background=(getColourByRowCol(row,col));
							  td.style.color=(getFontColourByRowCol(row,col));
							});
					    }
					    else {
					      cellProperties.renderer = (function (instance, td, row, col, prop, value, cellProperties) {
							  Handsontable.renderers.TextRenderer.apply(this, arguments);
							  td.style.background=(getColourByRowCol(row,col));
							  td.style.fontWeight=(getFontWeightByRowCol(row,col));
							  td.style.fontStyle=(getFontStyleByRowCol(row,col));
							  td.style.color=(getFontColourByRowCol(row,col));
							});
					    }

					    return cellProperties;
  					}
};
hooks = Handsontable.hooks.getRegistered();
hooks.forEach(function(hook) {
  sheetSettings[hook] = function() {
  	 // console.log(hook+arguments); write handler for spreadsheet events
  	 if(hook==="afterSelectionEndByProp") //mouseup after selection, as far as I can tell
  	 {
  	 	// for some reason it doesn't like arguments.slice(0,4), so I have to do this shit
  	 	for(var i=0;i<4;i++)
  	 		lastSheetSelectionBounds[i] = arguments[i];

  	 	document.getElementById("selectedCell").innerHTML 
  	 		= data[arguments[0]][arguments[1]] + " with confidence " + normalisedConfidences[arguments[0]][arguments[1]];
  	 }

  	 if(hook==="afterDocumentKeyDown") //after key pressed inside a cell, as far as I can tell
  	 {
  	 	// if a 'guess' has been edited, need to remove guess formatting
  	 	// in lastSheetSelectionBounds, 0 and 2 are the start and end rows, 1 and 3 are the start and end columns

  	 	for(var i=lastSheetSelectionBounds[0];i<=lastSheetSelectionBounds[2];i++)
  	 		for(var j=lastSheetSelectionBounds[1];j<=lastSheetSelectionBounds[3];j++)
  	 		{
  	 			var potentialIndex = getIndexOf(guessedSet,[i,j]);
  	 			if(potentialIndex!==-1)
  	 				guessedSet.splice(potentialIndex,1); // remove just that one element
  	 		}
  	 }
  }
});

var sheet = new Handsontable(sheetContainer, sheetSettings);
sheet.render();

// SET UP DISTANCE HISTORY CHART --------------------------------------------------


/* SOME OLD SPREADSHEET CODE, WHICH SUPPORTS FUNCTIONS
   CREDIT: https://jsfiddle.net/ondras/hYfN3/

	for (var i=0; i<6; i++) {
	    var row = document.getElementById("sheet").insertRow(-1);
	    for (var j=0; j<6; j++) {
	        var letter = String.fromCharCode("A".charCodeAt(0)+j-1);
	        row.insertCell(-1).innerHTML = i&&j ? "<input class='sheetCell' id='"+ letter+i +"'/>" : i||letter;
	    }
	}

	var DATA={}, INPUTS=[].slice.call(document.querySelectorAll("input.sheetCell"));
	INPUTS.forEach(function(elm) {
	    elm.onfocus = function(e) {
	        e.target.value = localStorage[e.target.id] || "";
	    };
	    elm.onblur = function(e) {
	        localStorage[e.target.id] = e.target.value;
	        computeAll();
	    };
	    var getter = function() {
	        var value = localStorage[elm.id] || "";
	        if (value.charAt(0) == "=") {
	            with (DATA) return eval(value.substring(1));
	        } else { return isNaN(parseFloat(value)) ? value : parseFloat(value); }
	    };
	    Object.defineProperty(DATA, elm.id, {get:getter});
	    Object.defineProperty(DATA, elm.id.toLowerCase(), {get:getter});
	});
	(window.computeAll = function() {
	    INPUTS.forEach(function(elm) { try { elm.value = DATA[elm.id]; } catch(e) {} });
	})();
*/

// BEGIN EVENT HANDLERS ----------------------------------------------------------

dCanvas.addEventListener('mousemove', function(evt) {
	var mousePos = getMousePos(dCanvas, evt);

	dContext.clearRect(0, 0, dCanvas.width, dCanvas.height);
	dContext.strokeStyle = "black";
	dContext.lineWidth = "3";
	drawData();
	drawLens(mousePos.y, mousePos.x);

	// the constants here are related to code in drawLens, don't let them fall out of sync
	dContext.strokeRect(0,
						mousePos.y-(50/dataImage.height)*dCanvas.height,
						dCanvas.width,
						(100/dataImage.height)*dCanvas.height);
}, false);

dCanvas.addEventListener('mouseover', function(evt) 
{
	var container = document.getElementById('lensContainer');
	container.style.display='initial';
}, false);

dCanvas.addEventListener('dblclick', function(evt) 
{
	// again, some of these constants are shared with the lens stuff... keep them in sync
	var mousePos = getMousePos(dCanvas, evt);
	sheetContainer.scrollTop = Math.max(0,(mousePos.y/dCanvas.height)*sheetContainer.scrollHeight-(50));

	// This doesn't work properly, I have to work out why at some point
	//sheetContainer.scrollLeft = (mousePos.y/dCanvas.width)*sheetContainer.scrollWidth;
}, false);

dCanvas.addEventListener('mouseout', function(evt) 
{
	document.getElementById('lensContainer').style.display='none';
	drawData();
}, false);

// BEGIN MAIN FUNCTION DEFINITIONS -----------------------------------------------------

// loadData may have funny properties because I haven't figured out the column numbers yet
// so will need to test on proper data to make sure it loads all columns
function loadData()
{
	var selected_file = document.getElementById('input').files[0];
	if(!selected_file) 
	{
		alert("No file chosen!");
		return;
	}
	var reader = new FileReader();  // Create a FileReader object
	reader.readAsText(selected_file);           // Read the file
	
	reader.onload = function(){    // Define an event handler
		var text = reader.result;   // This is the file contents
		var allTextLines = text.split(/\r\n|\n/);
		var lineAccumulator = [];
		nodes = [], edges = [];
		categorical = [];
		for (var i=0; i<allTextLines.length; i++) {
			  var elems = allTextLines[i].split(',');
			  var tarr = [i]; // start off with row number
			  for (var j=0; j<elems.length; j++) {
			  	  // may need to parse ints and floats here, by default stores as String
				  tarr[j+1] = elems[j];
				  if(!isNumber(elems[j]) && i>0)
				  	categorical[j] = true;
			  }
			  lineAccumulator[i] = tarr; // use to be push, but push is known to be slower than array referencing
			  if(i!==0) nodes[i-1] = {id: i, label: i.toString(), color:{border:'rgb(200,200,200)'}};
		}

		// all this shit needs to be inside the reader onload
		//data = lineAccumulator.slice(1,lineAccumulator.length);
		data = lineAccumulator; //now data contains headers as well
		headers = lineAccumulator[0];
		nRows = data.length;
		nCols = data[0].length;

		for(i=0;i<nCols-1;i++)
			if(categorical[i]!==true) categorical[i] = false;
		console.log("Categorical: "+categorical);

		confidences = singleValueArray(-1,nRows,nCols); // -1 signifies that no confidence has been computed yet
		normalisedConfidences = singleValueArray(0,nRows,nCols);

		console.log("Loaded: "+nRows+" rows, "+nCols+" columns.");

		lens.width = Math.round(cellWidth*nCols);
		trainingSet = [];
		guessedSet = [];
		dataImageStale = true;
		drawData();
		distanceHistory = [];
		divergenceHistory = [];

		sheet.loadData(data); //IMPORTANT: use this for new datasets; it can't handle just reassigning new data array
		sheet.render();
		//drawNetwork();
		networkData= {nodes: nodes, edges: edges};
		network.setData(networkData);
		drawDistributions();
		refreshMeanPairwiseDistance();
		redrawDistanceHistory();
	}
}

function drawData()
{
	if(dataImageStale)
	{
		var offscreenCanvasBG = document.createElement('canvas');
	    offscreenCanvasBG.width = nCols*cellWidth;
	    offscreenCanvasBG.height = nRows*cellHeight;
	    var contextBG = offscreenCanvasBG.getContext('2d');

		var offscreenCanvas = document.createElement('canvas');
	    offscreenCanvas.width = nCols*cellWidth;
	    offscreenCanvas.height = nRows*cellHeight;
	    var context = offscreenCanvas.getContext('2d');

	    context.font = '1pt Helvetica';

		for (var j=0; j<headers.length; j++)
		{
			contextBG.fillStyle = "rgb(220,220,220)";
			contextBG.fillRect(j*cellWidth,0,cellWidth,cellHeight);

			context.fillStyle = "rgb(220,220,220)";
			context.fillRect(j*cellWidth,0,cellWidth,cellHeight);

			context.fillStyle = 'black';
			context.fillText(headers[j], j*cellWidth, cellHeight);
		}

		for (var i=1;i<nRows;i++)
		{
			for (var j=0; j<nCols; j++)
			{	
				// background colour for lens
				context.fillStyle = getColourByRowCol(i,j);
				context.fillRect(j*cellWidth,i*cellHeight,cellWidth,cellHeight);
				
				// background colour for overview
				contextBG.fillStyle = getColourByRowCol(i,j);
				contextBG.fillRect(j*cellWidth,i*cellHeight,cellWidth,cellHeight);

				// finally, put in text
				context.fillStyle = 'black';
				context.fillText(data[i][j], j*cellWidth, (i+1)*cellHeight);
				//here i+1 as the x,y coordinates for text are actually the bottom left corner
			}
		}
		dataImage.src = offscreenCanvas.toDataURL();
		backgroundImage.src = offscreenCanvasBG.toDataURL();
		dContext.drawImage(backgroundImage,0,0,dCanvas.width,dCanvas.height);
		//console.log(dataImage.src)
		dataImageStale = false;
	}
	else
	{
		dContext.drawImage(backgroundImage,0,0,dCanvas.width,dCanvas.height);
	}	
}

function drawLens(mouseY, mouseX)
{
	var container = document.getElementById('lensContainer');
	container.style.top = mouseY-100+'px';
	container.style.left = mouseX+30+'px';
	
	var ctx = lens.getContext('2d');
	ctx.clearRect(0,0,lens.width,lens.height)
	// ARGUMENTS: context.drawImage(img,sx,sy,swidth,sheight,x,y,width,height);
	var center = Math.round((mouseY/dCanvas.height)*dataImage.height);
	
	ctx.drawImage(dataImage
				 ,0
				 ,Math.max(0,center-50)
				 ,dataImage.width
				 ,100
				 ,0
				 ,0
				 ,Math.min(lens.width,dataImage.width)
				 ,Math.min(lens.height,10*cellHeight));

	// persistent header row
	ctx.drawImage(dataImage
				 ,0
				 ,0
				 ,dataImage.width
				 ,cellHeight
				 ,0
				 ,0
				 ,Math.min(lens.width,dataImage.width)
				 ,10);
}

function drawNetwork()
{
	
	normaliseEdges();
	for(var i=0;i<nodes.length;i++)
	{
		// note the use of i+1 inside, since there isn't a node for the header column
		nodes[i]['color'] = 
			{
				border:getColourByRowCol(i+1,1),
				// if in training set, use the blue colour of the 0th column, else
				// use the confidence colour of the 1st column
				background:getColourByRowCol(i+1,(getIndexOf(trainingSet,i+1)!==-1)?0:1)
			};
	}
	//var e = new Error('dummy');
	//console.log(e.stack);
	networkData= {nodes: nodes, edges: edges};
	network.setData(networkData);
}

function drawDistributions()
{
	/*
	var exampleData = {
    labels: ["January", "February", "March", "April", "May", "June", "July"],
    datasets: [
        {
            label: "My First dataset",
            fillColor: "rgba(220,220,220,0.5)",
            strokeColor: "rgba(220,220,220,0.8)",
            highlightFill: "rgba(220,220,220,0.75)",
            highlightStroke: "rgba(220,220,220,1)",
            data: [65, 59, 80, 81, 56, 55, 40]
        },
        {
            label: "My Second dataset",
            fillColor: "rgba(151,187,205,0.5)",
            strokeColor: "rgba(151,187,205,0.8)",
            highlightFill: "rgba(151,187,205,0.75)",
            highlightStroke: "rgba(151,187,205,1)",
            data: [28, 48, 40, 19, 86, 27, 90]
        }
    ]
	};

	var chartOptions = {
	    //Boolean - Whether the scale should start at zero, or an order of magnitude down from the lowest value
	    scaleBeginAtZero : true,

	    //Boolean - Whether grid lines are shown across the chart
	    scaleShowGridLines : true,

	    //String - Colour of the grid lines
	    scaleGridLineColor : "rgba(0,0,0,.05)",

	    //Number - Width of the grid lines
	    scaleGridLineWidth : 1,

	    //Boolean - Whether to show horizontal lines (except X axis)
	    scaleShowHorizontalLines: true,

	    //Boolean - Whether to show vertical lines (except Y axis)
	    scaleShowVerticalLines: true,

	    //Boolean - If there is a stroke on each bar
	    barShowStroke : true,

	    //Number - Pixel width of the bar stroke
	    barStrokeWidth : 2,

	    //Number - Spacing between each of the X value sets
	    barValueSpacing : 5,

	    //Number - Spacing between data sets within X values
	    barDatasetSpacing : 1,

	    //String - A legend template
	    legendTemplate : "<ul class=\"<%=name.toLowerCase()%>-legend\"><% for (var i=0; i<datasets.length; i++){%><li><span style=\"background-color:<%=datasets[i].fillColor%>\"></span><%if(datasets[i].label){%><%=datasets[i].label%><%}%></li><%}%></ul>"
	}
	var myBarChart = new Chart(document.getElementById('chart').getContext('2d')).Bar(exampleData,chartOptions);
	*/

	var dataForCharts = {};
	
	// create necessary canvas elements and prepare dataForCharts
	$('.chart').remove(); // removes all existing nodes with class 'chart'
	var features = headers.slice(1,headers.length);
	var attValCounts = {};
	var attValCountsSelected = {};
	/* populates the attValCounts dictionary
			which is really a dictionary of dictionaries,
			indexed first by attribute names,
			and then by their values (so currently assumes categorical attributes).
			Keeps a count of how many have been seen.
			
			The attValCountsSelected dictionary is identical,
			except it is only incremented for rows within the bounds
			of the training set.
	*/

	for(var j=0; j<features.length; j++)
	{
		var f = features[j];
		
		if(categorical[j])
		{
			for(var i=1;i<nRows;i++)
			{
				var seriesAttributes = data[i];
				if(attValCounts[f]===undefined)
				{
					attValCounts[f] = {};
					attValCountsSelected[f] = {};
				}
				
				if(attValCounts[f][seriesAttributes[j+1]]===undefined)
				{
					attValCounts[f][seriesAttributes[j+1]] = 0;
					attValCountsSelected[f][seriesAttributes[j+1]] = 0;
				}
	
				attValCounts[f][seriesAttributes[j+1]]++;
				if(trainingSet.indexOf(i)!==-1) // if row in training set
					attValCountsSelected[f][seriesAttributes[j+1]]++;
			}
		}
		else
		{
			//count up bins for continuous data
			//need to first calculate ranges.

			var min = Number.MAX_VALUE, max = Number.MIN_VALUE;
			// does this *every* time. This is not necessary and could be optimised, only needs to be recalculated
			// whenever the spreadsheet is edited...
			for(var i=1;i<nRows;i++)
			{
				min = Math.min(min,data[i][j]);
				max = Math.max(max,data[i][j]);
			}
			min = Math.floor(min);
			max = Math.ceil(max);

			for(var i=1;i<nRows;i++)
			{
				var normDatum = (data[i][j]-min)/(max-min); // from 0 to 1
				var binIndex = Math.floor(normDatum*10) // from 0 to 10
				if (binIndex===10) binIndex = 9; // from 0-9, only 10 bins. not sure this is sound but whatever

				var bin =  sanitiseNumber((min+((max-min)*(binIndex/10))))
						  +" - "
						  +sanitiseNumber((min+((max-min)*((binIndex+1)/10))));

				if(attValCounts[f]===undefined)
				{
					attValCounts[f] = {};
					attValCountsSelected[f] = {};
				}
				
				if(attValCounts[f][bin]===undefined)
				{
					attValCounts[f][bin] = 0;
					attValCountsSelected[f][bin] = 0;
				}
	
				attValCounts[f][bin]++;
				if(trainingSet.indexOf(i)!==-1) // if row in training set
					attValCountsSelected[f][bin]++;
			}
		}
	
	}

	var newDivergence = 0;
	for(var i=0; i<features.length; i++)
	{
		var f = features[i];
		var newNode = document.createElement('div');
		newNode.className = 'chart';
		//newNode.innerHTML=f+'<br><canvas id=\''+f+'\' width="600" height="400"></canvas>';
		newNode.innerHTML=f+'<br><canvas id=\''+f+'\'></canvas>';
		document.getElementById('distributions').appendChild(newNode);
		

		var featureValues = getAllKeys(attValCounts[f]);
		featureValues.sort();
		var countsOverall = [];
		var countsSelected = [];
		for(var j=0; j<featureValues.length; j++)
		{
			countsOverall[j] = attValCounts[f][featureValues[j]];
			countsSelected[j] = attValCountsSelected[f][featureValues[j]];
		}

		newDivergence += hellinger(countsToProbabilities(countsOverall),countsToProbabilities(countsSelected));

		// one set of colour arguments only works for line charts,
		// the other only for bar charts. TODO: add conditional here to take care of it
		dataForCharts[f] = {
			labels: featureValues,
			datasets: [
				{
					label: "Overall",
					fillColor: "rgba(220,220,220,0.2)",
            		strokeColor: "rgba(220,220,220,1)",
            		pointColor: "rgba(220,220,220,1)",
		            pointStrokeColor: "#fff",
		            pointHighlightFill: "#fff",
		            pointHighlightStroke: "rgba(220,220,220,1)",
					data: countsOverall
				},
				{
					label: "Taught",
					fillColor: "rgba(151,187,205,0.2)",
		            strokeColor: "rgba(151,187,205,1)",
		            pointColor: "rgba(151,187,205,1)",
		            pointStrokeColor: "#fff",
		            pointHighlightFill: "#fff",
		            pointHighlightStroke: "rgba(151,187,205,1)",
					data: countsSelected
				}
			]
		}
	}
	newDivergence = sanitiseNumber(newDivergence);
	if(!(divergenceHistory.length>0 && divergenceHistory[divergenceHistory.length-1]===newDivergence))
	{
		divergenceHistory.push(newDivergence);
		// console.log("Added divergence: "+newDivergence);
	}
	
	// draw all charts using chart.js
	for(var i=0; i<features.length; i++)
	{
		var ctx = document.getElementById(features[i]).getContext('2d');
		var chartOptions = {animation:false,
			 				legendTemplate : "<ul class=\"<%=name.toLowerCase()%>-legend\">"
							 +"<% for (var i=0; i<datasets.length; i++){%>"
							 +"<li><span style=\"background-color:<%=datasets[i].fillColor%>\">"
							 +"<%if(datasets[i].label){%><%=datasets[i].label%><%}%></span>"
							 +"</li><%}%></ul>"
							};

		var myChart;
		if(categorical[i])
			var myChart = new Chart(ctx).Bar(dataForCharts[features[i]],chartOptions);
		else
			var myChart = new Chart(ctx).Line(dataForCharts[features[i]],chartOptions);

		//currently keeps writing this legend, could be more efficient
		document.getElementById("legend").innerHTML = myChart.generateLegend(); 
	}
}

function redrawDistanceHistory()
{
	// started trying to use the built-in update function, but couldn't get it to work properly
	var labelsForDistanceHistoryChart = new Array(distanceHistory.length);
	for(var i=0;i<distanceHistory.length;i++) labelsForDistanceHistoryChart[i] = i+1;

	dhcChartData = {
		labels: labelsForDistanceHistoryChart,
		datasets: [
			{
				label: "Confusion",
				fillColor: "rgba(220,220,220,0.2)",
	    		strokeColor: "rgba(220,220,220,1)",
	    		pointColor: "rgba(220,220,220,1)",
	            pointStrokeColor: "#fff",
	            pointHighlightFill: "#fff",
	            pointHighlightStroke: "rgba(220,220,220,1)",
				data: distanceHistory
			}
		]
	}

	$('#distanceHistory').remove(); // remove old canvas
	var newCanvasHTML = '<canvas id="distanceHistory"></canvas>';
	document.getElementById('distanceHistoryHolder').innerHTML+=newCanvasHTML;
	var ctx = document.getElementById('distanceHistory').getContext('2d');
	var chartOptions = {animation:true,
						scaleShowLabels:false,
						pointHitDetectionRadius: 1,
		 				legendTemplate : "<ul class=\"<%=name.toLowerCase()%>-legend\">"
						 +"<% for (var i=0; i<datasets.length; i++){%>"
						 +"<li><span style=\"background-color:<%=datasets[i].fillColor%>\">"
						 +"<%if(datasets[i].label){%><%=datasets[i].label%><%}%></span>"
						 +"</li><%}%></ul>"
						};

	var distanceHistoryChart;
	distanceHistoryChart = new Chart(ctx).Line(dhcChartData,chartOptions);
}

function redrawDivergenceHistory()
{
	// started trying to use the built-in update function, but couldn't get it to work properly
	var labelsForDivergenceHistoryChart = new Array(divergenceHistory.length);
	for(var i=0;i<divergenceHistory.length;i++) labelsForDivergenceHistoryChart[i] = i+1;

	dhcChartData = {
		labels: labelsForDivergenceHistoryChart,
		datasets: [
			{
				label: "Confusion",
				fillColor: "rgba(220,220,220,0.2)",
	    		strokeColor: "rgba(220,220,220,1)",
	    		pointColor: "rgba(220,220,220,1)",
	            pointStrokeColor: "#fff",
	            pointHighlightFill: "#fff",
	            pointHighlightStroke: "rgba(220,220,220,1)",
				data: divergenceHistory
			}
		]
	}

	$('#divergenceHistory').remove(); // remove old canvas
	var newCanvasHTML = '<canvas id="divergenceHistory"></canvas>';
	document.getElementById('divergenceHistoryHolder').innerHTML+=newCanvasHTML;
	var ctx = document.getElementById('divergenceHistory').getContext('2d');
	var chartOptions = {animation:true,
						scaleShowLabels:false,
						pointHitDetectionRadius: 1,
		 				legendTemplate : "<ul class=\"<%=name.toLowerCase()%>-legend\">"
						 +"<% for (var i=0; i<datasets.length; i++){%>"
						 +"<li><span style=\"background-color:<%=datasets[i].fillColor%>\">"
						 +"<%if(datasets[i].label){%><%=datasets[i].label%><%}%></span>"
						 +"</li><%}%></ul>"
						};

	var divergenceHistoryChart;
	divergenceHistoryChart = new Chart(ctx).Line(dhcChartData,chartOptions);
}

//TODO: prevent learning of rows with empty cells, or put in logic to manage it
function teach()
{
	var startRow = lastSheetSelectionBounds[0];
	var endRow   = lastSheetSelectionBounds[2];
	// 0 and 2 are the rows, 1 and 3 are the columns

	for(var i=startRow; i<=endRow; i++)
		if(trainingSet.indexOf(i)===-1) // if NOT already present
			trainingSet.push(i);

	refresh_confidences(); // also redraws overview, sheet and network
	drawDistributions();
	redrawDivergenceHistory();
}

function forget()
{
	var startRow = lastSheetSelectionBounds[0];
	var endRow   = lastSheetSelectionBounds[2];
	// 0 and 2 are the rows, 1 and 3 are the columns

	for(var i=startRow; i<=endRow; i++)
	{
		var index = trainingSet.indexOf(i)
		if(index!==-1) // if present
		{
			// this call makes splice remove 1 element, starting from index
			trainingSet.splice(index,1);
		}
	}

	// TODO: this refresh is incomplete. Copy over the refresh code from 'teach' function at some point
	dataImageStale = true;
	drawData();
	sheet.render();
}

function forgetAll()
{
	trainingSet = [];
	dataImageStale = true;
	drawData();
	sheet.render();
}

//can't call it try as that's a reserved keyword. LOL
function try_selection()
{
	var startRow = lastSheetSelectionBounds[0];
	var endRow   = lastSheetSelectionBounds[2];

	var startCol = lastSheetSelectionBounds[1];
	var endCol   = lastSheetSelectionBounds[3];
	// 0 and 2 are the rows, 1 and 3 are the columns
	// edit: not quite, TODO: fix this when user drags upwards or rightwards

	for(var i=startRow; i<=endRow; i++)
	{
		var index = trainingSet.indexOf(i)
		if(index===-1) // if not already in training set
		{
			for(var j=startCol;j<=endCol;j++)
				if(data[i][j]==="")
				{
					var prediction = kNNPredict(i,j,5); // the 3rd arg is how many neighbours
					var newCellValue = prediction[0];
					if(isNumber(newCellValue)) newCellValue = Math.round(newCellValue*100)/100; // cleanup
					data[i][j] = newCellValue;
					if(getIndexOf(guessedSet,[i,j])===-1) // if not already present
						guessedSet.push([i,j]);
					confidences[i][j] = prediction[1];
					console.log("Set confidence of "+[i,j].toString() + " to "+ prediction[1]);
				}
		}
	}

	normaliseConfidence();
	dataImageStale = true;
	drawData();
	sheet.render();
}

// why is this written with an underscore? what?
// this has become more like refreshAll()
function refresh_confidences()
{
	if(trainingSet.length===0)
	{
		alert('No training data!');
		return;
	}

	// maintaining this array structure in parallel as I need to check for duplicates
	// and object equality in javascript is difficult
	var edgeArray = [];
	edges = [];
	edgeCounter = 0;
	// TODO: is only doing this once per row sound?
	// so can optimise...
	for(var i=1;i<nRows;i++)
	{
		//console.log("Calculating confidence for row: "+i)
		var neighbours = kNN(i,5);
		var meanDist = 0;
		for(var j=0;j<neighbours.length;j++) 
		{
			meanDist+=parseFloat(neighbours[j][0]);
			var from = i, to = neighbours[j][1];

			// can experiment with only adding the 1-NN in the future
			// if not already present and not self-loop, but not checking in the opposite direction
			if(getIndexOf(edgeArray,[from,to])===-1 && from!==to)
			{
				//console.log("Adding edge: "+from+"-->"+to);
				edgeArray[edgeCounter] = [from,to];
				edges[edgeCounter] = {from: from, to: to, length: neighbours[j][0]};
				edgeCounter++;
			}
		}
		meanDist/=neighbours.length;
		for(var j=0;j<nCols;j++) confidences[i][j] = meanDist;
	}

	normaliseConfidence();
	dataImageStale = true;
	drawData();
	sheet.render();
	drawNetwork();
	redrawDistanceHistory();
	drawDistributions();
}

function refreshMeanPairwiseDistance()
{
	meanPairwiseDistance = 0;
	for(var i=1;i<nRows;i++)
	{
		for(var j=i+1;j<nRows;j++)
		{
			meanPairwiseDistance+=simpleEuclideanDistance(data[i],data[j]);
		}
	}
	var n = nRows-1;
	meanPairwiseDistance/=((n*(n+1))/2); // n + (n-1) + (n-2) + ...
	console.log("New mean pairwise distance: "+meanPairwiseDistance);
}

/*
function try_all()
{
	for(var i=1; i<nRows; i++)
	{
		var index = trainingSet.indexOf(i)
		if(index===-1) // if not already in training set
		{
			for(var j=1;j<nCols;j++)
				if(data[i][j]==="")
					data[i][j] = Math.round(Math.random()*10)
		}
	}

	dataImageStale = true;
	drawData();
	sheet.render();	
}
*/

// this function finds and returns the distances and row indices of the k nearest neighbours
//TODO: implement useCompleteRowsOnly argument
//TODO: fix logic for when the row referred to by the 'row' argument is only partially complete
function kNN(row,k)
{
	if (trainingSet.length===0) 
	{
		alert("No training data!");
		return;
	}

	// an array of arrays, each inner array is of length 2 and contains [distance, rowID]
	var neighbours = [];

	for (var i=0;i<trainingSet.length;i++)
	{
		var neighbourAdded = false;
		d = simpleEuclideanDistance(data[row],data[trainingSet[i]]);

		//insert where appropriate
		for (var j=0; j<neighbours.length; j++)
		{
			if(d<neighbours[j][0])
			{
				//console.log("Adding neighbour")
				//console.log("Before: "+neighbours)
				neighbours.splice(j,0,[d,trainingSet[i]]); // not x = x.splice(...); splice modifies original array
				//qconsole.log("After: "+neighbours)
				neighbourAdded = true;
				if (neighbours.length>k) 
				{
					// slice leaves the original array untouched so need to reassign
					neighbours = neighbours.slice(0,k);
					//console.log("Trimmed down neighbours to size "+neighbours.length);
				}
				break;
			}
		}

		// if not yet added, but space remains, just add it at the end
		if(neighbourAdded==false && (neighbours.length < k)) 
			neighbours.push([d,trainingSet[i]]);
	}

	//console.log(neighbours.toString());
	return neighbours;
}

// returns [prediction,mean distance]
function kNNPredict(row,col,k)
{
	var neighbours = kNN(row,k);
	//console.log("Received neighbours: "+neighbours);

	var meanDist = 0;
	for(var i=0;i<neighbours.length;i++)
		meanDist+=parseFloat(neighbours[i][0]); //add distance
	
	meanDist/=neighbours.length;

	var accumulator = 0;
	for(var i=0;i<neighbours.length;i++)
	{
		// if non-number encountered, start again assuming categorical strings
		if(!isNumber(data[neighbours[i][1]][col]))
		{
			var votes = new Array(neighbours.length);
			for(var i=0;i<neighbours.length;i++) votes[i] = (data[neighbours[i][1]][col]);
			var pred = mode(votes); // predict most frequent class
			return [pred,meanDist];
		}
		else
		{
			accumulator += parseFloat(data[neighbours[i][1]][col]);
		}
	}
	var pred = accumulator/neighbours.length;
	return [pred,meanDist];
}

function simpleEuclideanDistance(a,b)
{
	var acc = 0;
	// starting from 1 makes it ignore the row number, as it should...
	for(var i=1; i<a.length; i++)
		if(isNumber(a[i]) && isNumber(b[i]))
			acc += Math.pow(parseFloat(a[i])-parseFloat(b[i]),2);
		else
			acc += (a[i]===b[i]) ? 0 : 1;

	return Math.sqrt(acc);
}

function normaliseConfidence()
{
	var min = Number.MAX_VALUE, max = Number.MIN_VALUE;
	var meanDistance = 0;
	for(var i=0;i<confidences.length;i++)
		for(var j=0;j<confidences[i].length;j++) 
		{
			if(confidences[i][j]===-1) continue; // skip past uncalculated fields
			min = Math.min(min,confidences[i][j]);
			max = Math.max(max,confidences[i][j]);
			meanDistance += confidences[i][j];
		}

	meanDistance/=((nRows-1)*(nCols-1));
	meanDistance = sanitiseNumber(meanDistance);
	if(!(distanceHistory.length>0 && distanceHistory[distanceHistory.length-1]===meanDistance))
		distanceHistory.push(meanDistance);

	console.log("Max distance: "+max+". Min distance: "+min+". Mean distance: "+meanDistance);

	if (max===min) max+=1; // TODO: fix this shoddy hack

	for(var i=0;i<normalisedConfidences.length;i++)
		for(var j=0;j<normalisedConfidences[i].length;j++) 
		{
			if(confidences[i][j]===-1) continue; // skip past uncalculated fields
			normalisedConfidences[i][j] = (confidences[i][j]-min)/(max-min);
		}
}

function normaliseEdges()
{
	var min = Number.MAX_VALUE, max = Number.MIN_VALUE;

	for(var i=0;i<edges.length;i++)
	{
		min = Math.min(min,edges[i]['length']);
		max = Math.max(max,edges[i]['length']);
	}

	//console.log("Max and min edge lengths are "+max+" and "+min);

	if (max===min) max+=1; // TODO: fix this shoddy hack

	for(var i=0;i<edges.length;i++)
		edges[i]['length'] = ((100*edges[i]['length'])/(max-min))+30; // edges range from 30px to 130px
}

// calculates the hellinger distance between p and q
function hellinger(p,q)
{
	var bhattacharyaCoefficient = 0;
	for(var i=0;i<p.length;i++)
		bhattacharyaCoefficient += Math.sqrt(p[i]*q[i])
	var h = Math.sqrt(1-bhattacharyaCoefficient);
	return h;
}

// calculates the discrete Kullback-Liebler divergence of q from p
function discreteKL(p,q)
{
	// did you know that javascript's Math.log does the natural logarithm by default?
	var d = 0;
	for(var i=0;i<p.length;i++)
		d+=p[i]*Math.log(p[i]/q[i]);
	console.log("Divergence: "+d);
	console.log(p);
	console.log(q);
	return d;
}
// BEGIN UTILITY FUNCTION DEFINITIONS -----------------------------------------------------

function countsToProbabilities(counts)
{
	var sum = counts.reduce(function(a,b){return a+b;});
	// if sum is 0 (all counts 0) then return an all-zero array
	var probabilities = counts.map(function(e){return (sum!==0)? (e/sum ): 0;});
	return probabilities;
}

function getRandomColor()
{
	var red = Math.round(Math.random()*255);
	var green = Math.round(Math.random()*255);
	var blue = Math.round(Math.random()*255);
	
	return "rgb("+red+","+green+","+blue+")";
}

function sanitiseNumber(n)
{
	//2 significant figures
	var sigFigs = 2;
	if (decimalPlaces(n)<=sigFigs) 
		return n;
	else 
		return Math.round(n*Math.pow(10,sigFigs))/100;
}

function decimalPlaces(number) {
  // toFixed produces a fixed representation accurate to 20 decimal places
  // without an exponent.
  // The ^-?\d*\. strips off any sign, integer portion, and decimal point
  // leaving only the decimal fraction.
  // The 0+$ strips off any trailing zeroes.
  return ((+number).toFixed(20)).replace(/^-?\d*\.?|0+$/g, '').length
}

function getRedYellowGreenColorString(value)
{
	// doesn't do so well with negative numbers in range
	var normalised = value;
	
	var red;
	var green;
	var blue;
	
	blue = 0;
	// Goes through green-red hue transition in HSV space
	if(normalised<0.5)
	{
		green = 255;
		red = 2*normalised*255;
	}
	else
	{
		red = 255;
		// green = 255 when norm = 0.5, green = 0 when norm = 1. 
		// Solve the equation of that line and you end up with the following expression.
		green = 2*((-255*normalised)+255);
	}
	
	red = Math.round(red);
	green = Math.round(green);
	blue = Math.round(blue);
	
	//console.log(value+" --> "+normalised+" --> "+ "rgb("+red+","+green+","+blue+")")
	return "rgba("+red+","+green+","+blue+","+Math.max(0.1,normalised)+")";
	//return "rgba("+red+","+green+","+blue+","+1+")";
}

// makes a 'whiter' version of a colour by adding a constant to all its rgb components
// shelved for now as I don't really understand how to make it work properly
function getMutedColour(rgbColourString)
{
	// e.g. input string: rgb(17,255,43)
	var colourValuesString = rgbColourString.substring(4,rgbColourString.length-1);
	console.log(colourValuesString); // should give "17,255,43"
	colourValues = colourValuesString.split(',');
	newColourValues = [];
	for(var i=0; i<colourValues.length; i++)
		newColourValues[i] = Math.min(Math.round(parseInt(colourValues[i])+50),255);
	console.log("Muted colour is: "+"rgb("+newColourValues.toString()+")");
	return "rgb("+newColourValues.toString()+")";
}

function getColourByRowCol(row,col)
{

	if(col===0 && trainingSet.indexOf(row)!==-1)
		return "rgb(70, 130, 180)"; // previously tried rgb(173, 216, 230)
	else if(row===0 || col===0) 
		return "rgb(220,220,220)";
	else if(confidences[row][col]!==-1)
		return getRedYellowGreenColorString(normalisedConfidences[row][col]);
	else
		return "rgb(255,255,255)";
}

function getFontWeightByRowCol(row,col)
{
	return (getIndexOf(guessedSet,[row,col])===-1)?'normal':'bold';
}

function getFontStyleByRowCol(row,col)
{
	return (getIndexOf(guessedSet,[row,col])===-1)?'normal':'italic';
}

function getFontColourByRowCol(row,col)
{
	if(col===0 && trainingSet.indexOf(row)!==-1)
		return 'white';
	else
		return (getIndexOf(guessedSet,[row,col])===-1)?'black':'rgb(65,105,225)';
}

function getMousePos(canvas, evt) 
{
	var rect = canvas.getBoundingClientRect();
	return {
		x: evt.clientX - rect.left,
		y: evt.clientY - rect.top
	};
}

// from http://stackoverflow.com/questions/18082/validate-decimal-numbers-in-javascript-isnumeric
function isNumber(n) {return !isNaN(parseFloat(n)) && isFinite(n);}

// from http://stackoverflow.com/questions/1053843/get-the-element-with-the-highest-occurrence-in-an-array
function mode(array)
{
    if(array.length == 0)
    	return null;
    var modeMap = {};
    var maxEl = array[0], maxCount = 1;
    for(var i = 0; i < array.length; i++)
    {
    	var el = array[i];
    	if(modeMap[el] == null)
    		modeMap[el] = 1;
    	else
    		modeMap[el]++;	
    	if(modeMap[el] > maxCount)
    	{
    		maxEl = el;
    		maxCount = modeMap[el];
    	}
    }
    return maxEl;
}

// gets the index of an array from within an array of arrays, does not work for nested arrays
function getIndexOf(myArray, searchTerm) {
    for(var i=0; i<myArray.length; i++) {
        if (myArray[i].toString() === searchTerm.toString()) return i;
    }
    return -1;
}

function singleValueArray(value, rowCount, columnCount)
{
	var output = new Array(rowCount);
	for(var i=0;i<rowCount;i++)
	{
		output[i] = new Array(columnCount);
		for(var j=0;j<columnCount;j++)
			output[i][j] = value;
	}
	return output;
}

function getAllKeys(obj) 
{
	var r = [];
	for (var k in obj)
		if (obj.hasOwnProperty(k))
				r.push(k);

	return r;
}