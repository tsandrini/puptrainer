// What a column says about itself beyond TanStack's own definition.
import '@tanstack/table-core';

declare module '@tanstack/table-core' {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interface ColumnMeta<TData extends RowData, TValue> {
		/** Its name in the column picker (the header may be an icon or empty). */
		label?: string;
		/** What the header says on a long press or hover: the unit, what it is counted from. */
		title?: string;
		headClass?: string;
		cellClass?: string;
	}
}
