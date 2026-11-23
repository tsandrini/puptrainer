// The parts of ECharts the app uses, registered once. ECharts draws the
// charts of statistics over takes (the Progress page); a signal over one
// take is drawn by `Plot` (uPlot). Nothing outside this directory imports
// ECharts' code: charts are made through `Chart` and `ChartCard`.
import { BarChart, CustomChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import {
	AxisPointerComponent,
	BrushComponent,
	CalendarComponent,
	DataZoomComponent,
	GridComponent,
	LegendComponent,
	MarkAreaComponent,
	MarkLineComponent,
	ToolboxComponent,
	TooltipComponent,
	VisualMapComponent
} from 'echarts/components';
import * as echarts from 'echarts/core';
import langCS from 'echarts/lib/i18n/langCS.js';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
	BarChart,
	CustomChart,
	HeatmapChart,
	LineChart,
	ScatterChart,
	AxisPointerComponent,
	BrushComponent,
	CalendarComponent,
	DataZoomComponent,
	GridComponent,
	LegendComponent,
	MarkAreaComponent,
	MarkLineComponent,
	ToolboxComponent,
	TooltipComponent,
	VisualMapComponent,
	CanvasRenderer
]);
echarts.registerLocale('CS', langCS);

export { echarts };
export type Instance = echarts.ECharts;
