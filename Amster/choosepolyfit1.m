function [coef,sig,igood,ibad,fit,iter,fig]=choosepolyfit1(x,y,n,nsig,diagflag)
if nargin<4, nsig=3; end
if nargin<5, diagflag=0; end
if diagflag==0, fig=[]; end
% this version works on only up to 1D
  x=x(:);
  y=y(:);
  hit=find(~isnan(x)&~isnan(y));
  igood=hit;
  [m,junk]=size(x);
  ibad=(1:m)';
  ibad(igood)=[];
  iter=0;
  if diagflag,
    cf=get(groot,'CurrentFigure');
    fig=figure; drawnow;
    plot(x(igood),y(igood),'o'); hold on;
    hf=plot(x(igood),y(igood),'o');
  end
  while 1,
    coef=polyfit(x(igood),y(igood),n);
    fit=polyval(coef,x(igood));
    err=y(igood)-fit;
    sig=rms(err);
    miss=find(abs(err)>nsig*sig);
    if diagflag,
      delete(hf);
      [xgood,isort]=sort(x(igood));
      hf=plot(xgood,fit(isort),'-');
      plot(x(igood(isort(miss))),y(igood(isort(miss))),'kx');
      drawnow;
    end
    if length(miss),
      iter=iter+1;
      ibad=[ibad;miss(:)];
      igood(miss)=[];
    else
      break;
    end
  end

  if diagflag,
    if ~isempty(cf),
      figure(cf);
    end
  end
  
    
  