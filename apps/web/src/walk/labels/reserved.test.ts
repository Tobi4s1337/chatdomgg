import { expect, it } from 'vitest';
import { measureReservedElements } from './reserved';

it('converts visible HUD bounds into a scaled layer coordinate system', () => {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const root = { clientWidth: 200, clientHeight: 100, getBoundingClientRect: () => rect(100, 50, 400, 200),
    ownerDocument: { defaultView: { getComputedStyle: (element: { visible: boolean }) => ({ display: element.visible ? 'block' : 'none', visibility: 'visible', opacity: '1' }) } } } as unknown as HTMLElement;
  const element = (visible: boolean) => ({ visible, isConnected: true, getClientRects: () => [1], getBoundingClientRect: () => rect(140, 70, 80, 40) }) as unknown as Element;
  expect(measureReservedElements(root, [element(true), element(false)])).toEqual([{ left: 20, top: 10, right: 60, bottom: 30 }]);
});
