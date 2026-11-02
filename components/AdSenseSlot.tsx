import React, { useEffect } from 'react';
import { requestAdFill, useAdSenseSlot, type AdSlotKey } from '../src/lib/adsense';

interface AdSenseSlotProps {
  slotKey: AdSlotKey;
}

/**
 * 廣告舞台（Ad Shell ②）的實際載體。
 *
 * - 網頁版且 slot id 已設定、且 AdSense script 載入完成 → 渲染 <ins> 並 push() 填充
 * - 原生平台 / slot 未設定 / script 載入失敗或逾時 → 渲染品牌佔位板
 *
 * 兩者都不會出現「永遠空白的死 <ins> 框」，也不會曝露 ad unit id。
 */
export const AdSenseSlot: React.FC<AdSenseSlotProps> = ({ slotKey }) => {
  const { client, slot, renderable } = useAdSenseSlot(slotKey);

  // <ins> 動態掛載後再 push 一次，確保它進入 AdSense 的填充佇列
  useEffect(() => {
    if (renderable) requestAdFill();
  }, [renderable]);

  if (!renderable) {
    return (
      <div className="flex min-h-[100px] w-full flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-[#334155] bg-[#101A2B] px-4 py-3 text-center">
        <div className="h-[3px] w-[120px] rounded-full bg-gradient-to-r from-transparent via-blue-400 to-transparent opacity-70" />
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#94A3B8]">廣告載位 · 贊助支持</div>
      </div>
    );
  }

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block', width: '100%' }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
};
