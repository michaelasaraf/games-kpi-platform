import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, MarkLineComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, BarChart, GridComponent, LegendComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);

export interface Series {
  name: string;
  values: (number | null)[];
  /** CSS variable holding the series color, e.g. --series-1. Fixed per entity, never by rank. */
  color: string;
  kind?: 'line' | 'bar';
}

interface Props {
  x: (string | number)[];
  series: Series[];
  format: (v: number | null) => string;
  height?: number;
  /** Optional dashed target line (e.g. D1 target 40%). */
  target?: { value: number; label: string };
  xName?: string;
  /** Numeric x (e.g. days since install): spaced to scale, labelled with this formatter. */
  numericX?: (v: number) => string;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** One-axis line or bar chart with a crosshair tooltip, themed from the CSS tokens. */
export function Chart({ x, series, format, height = 260, target, xName, numericX }: Props) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current);
    const draw = () => {
      const muted = cssVar('--text-muted');
      const secondary = cssVar('--text-secondary');
      const grid = cssVar('--grid');
      const axis = cssVar('--axis');
      const isBar = series.every((s) => s.kind === 'bar');
      chart.setOption(
        {
          animation: false,
          textStyle: { fontFamily: cssVar('--font') },
          grid: { left: 8, right: 16, top: series.length > 1 ? 36 : 12, bottom: xName ? 28 : 8, containLabel: true },
          legend: series.length > 1
            ? { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { color: secondary } }
            : undefined,
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: isBar ? 'shadow' : 'line', lineStyle: { color: axis } },
            backgroundColor: cssVar('--surface-raised'),
            borderColor: cssVar('--border'),
            textStyle: { color: cssVar('--text-primary') },
            valueFormatter: (v: unknown) => format(typeof v === 'number' ? v : null),
          },
          xAxis: {
            type: numericX ? 'value' : 'category',
            data: numericX ? undefined : x,
            min: numericX ? 'dataMin' : undefined,
            max: numericX ? 'dataMax' : undefined,
            splitLine: { show: false },
            name: xName,
            nameLocation: 'middle',
            nameGap: 26,
            nameTextStyle: { color: muted },
            boundaryGap: isBar,
            axisLine: { lineStyle: { color: axis } },
            axisTick: { show: false },
            axisLabel: { color: muted, hideOverlap: true, formatter: numericX },
          },
          yAxis: {
            type: 'value',
            splitLine: { lineStyle: { color: grid } },
            axisLabel: { color: muted, formatter: (v: number) => format(v) },
          },
          series: series.map((s, i) => ({
            name: s.name,
            type: s.kind ?? 'line',
            data: numericX ? s.values.map((v, j) => [x[j], v]) : s.values,
            // Sparse series (a new game, a short range) need dots, or a lone point is invisible.
            showSymbol: s.values.filter((v) => v != null).length <= 8,
            symbolSize: 8,
            connectNulls: false,
            lineStyle: { width: 2 },
            barMaxWidth: 28,
            itemStyle: { color: cssVar(s.color), borderRadius: s.kind === 'bar' ? [4, 4, 0, 0] : 0 },
            emphasis: { focus: 'series' },
            markLine:
              target && i === 0
                ? {
                    silent: true,
                    symbol: 'none',
                    lineStyle: { type: 'dashed', color: secondary, width: 1 },
                    label: { formatter: target.label, color: secondary, position: 'insideEndTop' },
                    data: [{ yAxis: target.value }],
                  }
                : undefined,
          })),
        },
        true,
      );
    };
    draw();
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', draw);
    return () => {
      window.removeEventListener('resize', resize);
      media.removeEventListener('change', draw);
      chart.dispose();
    };
  }, [x, series, format, target, xName, numericX]);

  return <div ref={el} style={{ width: '100%', height }} role="img" aria-label={series.map((s) => s.name).join(', ')} />;
}
