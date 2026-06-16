function s=stdnan(x)
  ii=find(~isnan(x));
  s=std(x(ii));