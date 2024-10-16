export type tChartDefinition = {
    chartName: string,
    chartType: string,
    sources: {
        [key: string]: {
            color: string,
            name: string
        }
    }
}