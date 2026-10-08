import { useState } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AdminProductForm, { EMPTY_PRODUCT_FORM } from '@/components/AdminProductForm';
import AdminCouponForm, { EMPTY_COUPON_FORM } from '@/components/AdminCouponForm';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render } from './helpers';

function Harness({ kind, busy = false }: { kind: 'product' | 'coupon'; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open editor</button>{open && (kind === 'product'
    ? <AdminProductForm idPrefix="keyboard" heading="Product editor" submitLabel="Save product" values={EMPTY_PRODUCT_FORM}
      categories={[]} categoriesLoading={false} categoriesFailed={false} onRetryCategories={() => {}} busy={busy}
      onChange={() => {}} onClose={() => setOpen(false)} onSubmit={() => {}} />
    : <AdminCouponForm values={EMPTY_COUPON_FORM} busy={busy} onChange={() => {}} onClose={() => setOpen(false)} onSubmit={() => {}} />)}
    <button>Background action</button></>;
}
describe('administrator editor dialogs', () => {
  it.each(['product', 'coupon'] as const)('%s opens as a named modal and restores focus on cancellation', kind => {
    render(<Harness kind={kind} />);
    const opener = screen.getByRole('button', { name: 'Open editor' }); opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: kind === 'product' ? 'Product editor' : '创建优惠券' });
    expect(dialog).toHaveAttribute('open'); expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(opener).toHaveFocus();
  });
  it.each(['product', 'coupon'] as const)('%s ignores cancellation during a save, then permits it', kind => {
    const view = render(<Harness kind={kind} busy />);
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
    const dialog = screen.getByRole('dialog'); fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(dialog).toBeInTheDocument(); expect(dialog).toHaveAttribute('open');
    view.rerender(<Harness kind={kind} busy={false} />);
    fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it.each(['zh-CN', 'en'] as const)('labels the product close control in %s', locale => {
    useLocaleStore.setState({ locale }); render(<Harness kind="product" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Close' : '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('allows language changes inside the modal without closing the editor', () => {
    render(<Harness kind="product" />); fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox', { name: '界面语言' }), { target: { value: 'en' } });
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument(); expect(dialog).toHaveAttribute('open');
  });
});
