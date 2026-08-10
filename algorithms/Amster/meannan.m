function m=meannan(x)
  ii=find(~isnan(x));
  m=mean(x(ii));