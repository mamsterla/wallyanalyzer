function [M,S,igood,ibad,x]=choose(x,nsig)
% M: mean
% S: std
% this version works on only up to 1D
  if nargin<2, nsig=3; end
  [n,m]=size(x);
  x=x(:);
  while 1,
    M=meannan(x);
    S=stdnan(x);
    ibad=find(abs(x-M)>nsig*S);
    if length(ibad)<1, break; end
    x(ibad)=nan;
  end
  ibad=find(isnan(x));
  igood=[1:n*m]';
  igood(ibad)=[];
  if nargout>4,
      x=reshape(x,m,n);
  end
  