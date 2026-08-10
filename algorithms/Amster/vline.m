function h=vline(x,lt,bound,ax);
  if nargin<4, ax=gca; end
  if nargin<3, bound=0; end % percentage of range left blank as boundary
  if nargin<2, lt='--'; end
  if nargin<1, x=[]; end
  ca=gca;
  axes(ax);
  ylim=get(ax,'ylim');
  dy=diff(ylim);
  y=ylim'+bound*dy/100*[1 -1]';
  x=x(:)';
  hold on;
  h=plot(repmat(x,2,1),repmat(y,1,length(x)),lt);
  axis(ca);
  